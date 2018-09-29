/*
 * ove.js v@VERSION
 * https://github.com/dsi-icl/ove
 *
 * Copyright (c) @AUTHOR
 * Released under @LICENSE License
 */
//-- IMPORTANT: all code comments must be in this format. --//
function OVE (appId) {
    // @CONSTANTS

    //-- Hostname is detected using the URL at which the OVE.js script is loaded. It can be read --//
    //-- with or without the scheme (useful for opening WebSockets).                             --//
    const getHostName = function (withScheme) {
        let scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            if (scripts[i].src.indexOf('ove.js') > 0) {
                return scripts[i].src.substr(
                    withScheme ? 0 : scripts[i].src.indexOf('//') + 2,
                    scripts[i].src.lastIndexOf('/') - (withScheme ? 0 : scripts[i].src.indexOf('//') + 2));
            }
        }
    };

    //-----------------------------------------------------------//
    //--                 Messaging Functions                   --//
    //-----------------------------------------------------------//
    const OVESocket = function (__private) {
        //-- Default onMessage handler does nothing --//
        let onMessage = function () { return 0; };

        //-- Socket init code --//
        const getSocket = function (url) {
            __private.ws = new WebSocket(url);
            __private.ws.addEventListener('error', console.error);
            __private.ws.addEventListener('open', function () {
                if (__DEBUG__) {
                    console.log('websocket connection made with ' + url);
                }
            });
            __private.ws.addEventListener('message', function (m) {
                const data = JSON.parse(m.data);
                if (__DEBUG__) {
                    //-- We want to print the time corresponding to the local timezone based on the locale  --//
                    console.log(JSON.stringify(data));
                }
                //-- Apps receive the message if either it was sent to all sections or the specific section --//
                //-- of the app. Apps will not receive messages sent to other apps.                         --//
                if (data.appId === __private.appId && (!data.sectionId || data.sectionId === __private.sectionId)) {
                    onMessage(data.message);
                }
            });
            __private.ws.addEventListener('close', function () {
                if (__DEBUG__) {
                    console.warn('lost websocket connection attempting to reconnect');
                }
                //-- If the socket is closed, we try to refresh it. This fixes frozen pages after a restart --//
                setTimeout(function () { getSocket(url); }, Constants.SOCKET_REFRESH_DELAY);
            });
        };
        getSocket('ws://' + getHostName(false) + '/');

        //-- SDK functions --//
        this.on = function (func) {
            onMessage = func;
        };
        this.send = function (message, appId) {
            //-- The identifier of the target application could be omitted if the message was sent to self. --//
            const targetAppId = arguments.length > 1 ? appId : __private.appId;

            //-- We always wait for the socket to be ready before broadcast. The same code blocks messages  --//
            //-- when a socket is temporarily closed.                                                       --//
            new Promise(function (resolve) {
                const x = setInterval(function () {
                    if (__private.ws.readyState === WebSocket.OPEN) {
                        clearInterval(x);
                        resolve('socket open');
                    }
                }, Constants.SOCKET_READY_DELAY);
            }).then(function () {
                //-- The same code works for the OVE core viewer (which has no sectionId) and OVE core apps --//
                if (__private.sectionId) {
                    __private.ws.send(JSON.stringify({ appId: targetAppId, sectionId: __private.sectionId, message: message }));
                } else {
                    __private.ws.send(JSON.stringify({ appId: targetAppId, message: message }));
                }
            });
        };
    };

    //-----------------------------------------------------------//
    //--                   Layout Variables                    --//
    //-----------------------------------------------------------//
    const setLayout = function (__self, __private) {
        __self.layout = {};
        const fetchSection = function (sectionId) {
            if (sectionId) {
                if (__DEBUG__) {
                    console.log('requesting details of section: ' + sectionId);
                }
                fetch(getHostName(true) + '/section/' + sectionId)
                    .then(function (r) { return r.text(); }).then(function (text) {
                        const section = JSON.parse(text);
                        __self.layout.section = { w: section.w, h: section.h };
                        __self.state.name = OVE.Utils.getQueryParam('state', section.state);
                        __private.sectionId = section.id;
                        if (__DEBUG__) {
                            console.log('got details from section: ' + section.id);
                        }
                        //-- We wait for section information to be available before announcing OVE loaded   --//
                        $(document).trigger(OVE.Event.LOADED);
                    });
            }
        };
        let id = OVE.Utils.getQueryParam('oveClientId');
        //-- clientId will not be provided by a controller --//
        if (!id) {
            fetchSection(OVE.Utils.getQueryParam('oveSectionId'));
            return;
        }
        let sectionId = id.substr(id.lastIndexOf('.') + 1);
        id = id.substr(0, id.lastIndexOf('.'));
        if (!id && sectionId) {
            //-- sectionId has not been provided as a part of oveClientId  --//
            //-- oveClientId has the format "{space}-{client}.{sectionId}" --//
            //-- the ".{sectionId}" portion is optional and can be omitted --//
            id = sectionId;
            sectionId = OVE.Utils.getQueryParam('oveSectionId');
        }
        const client = id.substr(id.lastIndexOf('-') + 1);
        const space = id.substr(0, id.lastIndexOf('-'));

        //-- call APIs /clients or /client/{sectionId}  --//
        fetch(getHostName(true) + '/client' + (sectionId ? '/' + sectionId : 's'))
            .then(function (r) { return r.text(); }).then(function (text) {
                __self.layout = (JSON.parse(text)[space] || [])[client] || {};
                fetchSection(sectionId);
            });
    };

    //-----------------------------------------------------------//
    //--            Shared State and Local Context             --//
    //-----------------------------------------------------------//
    const OVEState = function (__private) {
        //-- State can be cached/loaded at an app-level --//
        this.cache = function (url) {
            $.ajax({ url: url || (__private.sectionId + '/state'), type: 'POST', data: JSON.stringify(this.current), contentType: 'application/json' });
        };
        this.load = function (url) {
            let __self = this;
            return new Promise(function (resolve, reject) {
                $.get(url || (__private.sectionId + '/state')).done(function (state) {
                    if (state) {
                        __self.current = state;
                        resolve('state loaded');
                    } else {
                        reject(new Error('state not loaded'));
                    }
                });
            });
        };
        this.current = {};
        this.name = undefined;
    };

    //-- holds private data within OVE library --//
    let __private = { appId: appId };

    this.context = {
        //-- A version 4 UUID is available for each OVE instance. This to support intra/inter-app --//
        //-- messaging and debugging.                                                             --//
        uuid: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = Math.random() * 16 | 0;
            let v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        }),

        //-- The identifier that was provided when creating OVE is stored on the context as appId.--//
        //-- This is used by most utility functions such as logging. This can be overridden after --//
        //-- initialization of OVE. However, all internal logging within OVE will be using the    --//
        //-- __private.appId variable, which cannot be overridden without creating a new instance --//
        //-- of OVE - which is enforced by design.                                                --//
        appId: __private.appId
    };

    this.socket = new OVESocket(__private);
    this.state = new OVEState(__private);
    setLayout(this, __private);
}

//-----------------------------------------------------------//
//--                   OVE Event Names                     --//
//-----------------------------------------------------------//
OVE.Event = {
    LOADED: 'ove.loaded'
};
