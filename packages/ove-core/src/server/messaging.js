const _bridge = (m, server, Constants) => {
    // returns the section information for a given id
    const _getSectionForId = (sectionId) => server.state.get('sections').find(s => Number(s.id) === Number(sectionId));
    // returns the context corresponding to the space or undefined if not connected
    const _getContext = (space) => {
        const primary = server.contexts.find(context => context.primary === space);
        return !primary ? server.contexts.find(context => context.secondary.includes(space)) : primary;
    };
    // whether a space is primary within the given context
    const _isPrimaryForContext = (context, space) => space === context.primary;
    // whether a section is primary within the given context
    const _sectionIsPrimaryForContext = (context, sectionId) => _isPrimaryForContext(context, _getSpaceForSection(_getSectionForId(sectionId)));
    // returns the replicated sections for the sectionId
    const _getReplicas = (context, sectionId) => context.map.filter(s => Number(s.primary) === Number(sectionId)).map(s => s.secondary);
    // returns the space for a section
    const _getSpaceForSection = (section) => Object.keys(section.spaces)[0];
    // returns the context corresponding to the space the section with id: sectionId is contained in
    const _getContextForSection = (sectionId) => {
        const section = _getSectionForId(sectionId);
        if (!section) return undefined;
        return _getContext(_getSpaceForSection(section));
    };

    const context = _getContextForSection(m.sectionId);
    if (!context || !_sectionIsPrimaryForContext(context, m.sectionId) || !m.message.name || m.message.name !== Constants.Events.UPDATE_MC || m.message.uuid <= context.uuid) return;
    m.message.secondary = true;
    context.uuid = m.message.uuid;
    const secondaryIds = _getReplicas(context, m.sectionId);
    server.wss.clients.forEach(c => {
        if (c.readyState !== Constants.WEBSOCKET_READY) return;
        secondaryIds.forEach(id => {
            const newMessage = { appId: m.appId, sectionId: id.toString(), message: m.message };
            c.safeSend(JSON.stringify(newMessage));
        });
    });
}

module.exports = function (server, log, Constants) {
    const peers = server.peers;



    /**************************************************************
                        Messaging Functionality
    **************************************************************/
    return function (s) {
        s.safeSend(JSON.stringify({ func: 'connect' }));
        s.on('message', function (msg) {
            let m = JSON.parse(msg);
            // The clock sync request is the one with the highest priority and the server should
            // make no further checks before responding.
            if (m.sync) {
                if (!m.sync.t1) {
                    s.safeSend(JSON.stringify({
                        appId: m.appId,
                        sync: { id: m.sync.id, serverDiff: (server.clock.diff || 0) }
                    }));
                } else {
                    s.safeSend(JSON.stringify({
                        appId: m.appId,
                        sync: {
                            id: m.sync.id,
                            serverDiff: m.sync.serverDiff,
                            t2: new Date().getTime(),
                            t1: m.sync.t1
                        }
                    }));
                }
                log.trace('Responded to sync request for client:', m.sync.id);
                return;
            } else if (m.syncResults) {
                m.syncResults.forEach(function (r) {
                    if (!server.clock.syncResults[r.id]) {
                        server.clock.syncResults[r.id] = [];
                    }
                    server.clock.syncResults[r.id].push(r.diff);
                });
                return;
            }

            if (m.forwardedBy) {
                // We will ignore anything that we have already forwarded.
                if (m.forwardedBy.includes(peers.uuid)) {
                    return;
                } else if (m.message.op) {
                    peers.receive.forEach(function (fn) {
                        fn(m.message);
                    });
                    return;
                }
            }

            // The registration operation is meant for associating a socket with its corresponding
            // section identifier or space and client identifier.
            if (m.registration) {
                if (m.registration.sectionId !== undefined) {
                    log.debug('Registering socket for section:', m.registration.sectionId);
                    s.sectionId = m.registration.sectionId;
                    return;
                }
                if (m.registration.client !== undefined && m.registration.space !== undefined) {
                    log.debug('Registering socket for client:', m.registration.client, 'of space:', m.registration.space);
                    s.client = m.registration.client;
                    s.space = m.registration.space;
                }
                return;
            }

            // All methods except the method for viewers to request section information that
            // helps browser crash recovery
            if (m.appId !== Constants.APP_NAME || m.message.action !== Constants.Action.READ) {
                server.wss.clients.forEach(function (c) {
                    // We respond to every socket but not to the sender
                    if (c !== s && c.readyState === Constants.WEBSOCKET_READY) {
                        // All messages associated with a section will only be routed to the sockets
                        // belonging to that section. The section identifier is either set at a top
                        // level, for messages originating from applications. It is defined within
                        // the message body, for messages generated by OVE core.
                        let sectionId = m.sectionId || m.message.id;
                        if (!sectionId || !c.sectionId || sectionId === c.sectionId) {
                            if (Constants.Logging.TRACE_SERVER) {
                                log.trace('Sending to socket:', c.id, ', message:', msg);
                            }
                            c.safeSend(msg);
                        }
                    }
                });
                // We forward the same message to all peers
                peers.send(m);

                if (m.sectionId) {
                    _bridge(m, server, Constants);
                }
                return;
            }

            // We need a section id for anything beyond this point.
            if (m.sectionId !== undefined) {
                // specifically testing for undefined since '0' is a valid input.
                log.error('Section information cannot be requested from within a section');
                return;
            }

            // Method for viewers to request section information, helps browser crash recovery
            const sections = server.state.get('sections');
            sections.forEach(function (section, sectionId) {
                // We respond only to the sender and only if a section exists.
                if (section && s.readyState === Constants.WEBSOCKET_READY) {
                    // Sections are created on the browser and then the application is deployed after a
                    // short delay. This will ensure proper frame sizes.
                    s.safeSend(JSON.stringify({ appId: Constants.APP_NAME, message: { action: Constants.Action.CREATE, id: sectionId, spaces: section.spaces } }));
                    if (section.app) {
                        setTimeout(function () {
                            s.safeSend(JSON.stringify({ appId: Constants.APP_NAME, message: { action: Constants.Action.UPDATE, id: sectionId, app: section.app } }));
                        }, Constants.SECTION_UPDATE_DELAY);
                    }
                }
            });
        });
        /* istanbul ignore else */
        // DEBUG logging is turned on by default, and only turned off in production deployments.
        // The operation of the Constants.Logging.DEBUG flag has been tested elsewhere.
        if (Constants.Logging.DEBUG) {
            // Associate an ID for each WebSocket, which will subsequently be used when logging.
            s.id = server.wss.clients.size;
            log.debug('WebSocket connection established. Clients connected:', server.wss.clients.size);
        }
    };
};
