/*
filter = filter.nodesBy(function (n) {
    if (evaluate(n, nodeFilter)) {
        n.color = nodeColor;
    }
};
*/

// Calling getPredicate constructs a predicate function corresponding to the provided AST
// Can be used like:

const { Constants } = require('./constants');

// const { _, Utils } = require('@ove-lib/utils')(appName, app, dirs);
// const log = Utils.Logger(appName);

exports.getPredicate = function (filter) {
    // Helper method to retrieve a property from an element
    const getFromElement = function (element, propertyName) {
        if (!propertyName || !propertyName.includes('.')) {
            if (element[propertyName] !== undefined) {
                return element[propertyName];
            } else {
                return element.attributes ? element.attributes[propertyName] : undefined;
            }
        }
        const firstPart = propertyName.substring(0, propertyName.indexOf('.'));
        const otherParts = propertyName.substring(propertyName.indexOf('.') + 1);
        const childElement = element[firstPart] ||
            (element.attributes ? element.attributes[firstPart] : undefined);
        return getFromElement(childElement, otherParts);
    };

    // IMPORTANT: There are no logs within the filter evaluation operations to ensure
    // the most optimum performance. The logs corresponding to the operation carried out
    // can be used for debugging purposes.
    const evaluate = function (element, filter) {
        // Evaluate as a number
        const evaluateN = function (element, filter) {
            return +(evaluate(element, filter));
        };
        // Evaluate as a string
        const evaluateS = function (element, filter) {
            const res = evaluate(element, filter);
            return res || res === 0 ? res.toString() : undefined;
        };
        // Evaluate a function
        const evaluateF = function (element, func, args) {
            const firstArg = evaluateS(element, args[0]);
            if (firstArg === undefined) {
                return undefined;
            }
            const secondArg = args.length > 1 ? evaluateS(element, args[1]) : undefined;
            if (secondArg === undefined && args.length > 1) {
                return undefined;
            }
            const thirdArg = args.length > 2 ? evaluateS(element, args[2]) : undefined;
            if (thirdArg === undefined && args.length > 2) {
                return undefined;
            }
            switch (func) {
                case Constants.Evaluation.Function.SUBSTRING:
                    // Unable to use secondArg and thirdArg as the replace method expects
                    // numeric arguments.
                    if (args.length > 2) {
                        return firstArg.substring(evaluateN(element, args[1]),
                            evaluateN(element, args[2]));
                    }
                    return firstArg.substring(evaluateN(element, args[1]));
                case Constants.Evaluation.Function.SUBSTRING_OF:
                    // IMPORTANT: Order of arguments have been swapped in the specification.
                    return secondArg.includes(firstArg);
                case Constants.Evaluation.Function.ENDS_WITH:
                    return firstArg.endsWith(secondArg);
                case Constants.Evaluation.Function.STARTS_WITH:
                    return firstArg.startsWith(secondArg);
                case Constants.Evaluation.Function.LENGTH:
                    return firstArg.length;
                case Constants.Evaluation.Function.INDEX_OF:
                    return firstArg.indexOf(secondArg);
                case Constants.Evaluation.Function.REPLACE:
                    return firstArg.replace(secondArg, thirdArg);
                case Constants.Evaluation.Function.TO_LOWER:
                    return firstArg.toLowerCase();
                case Constants.Evaluation.Function.TO_UPPER:
                    return firstArg.toUpperCase();
                case Constants.Evaluation.Function.TRIM:
                    return firstArg.trim();
                case Constants.Evaluation.Function.CONCAT:
                    return firstArg + secondArg;
                default:
                    // The specification is large and we don't support all types of
                    // operators/functions
                    const err = 'Unable to evaluate unknown function: ' + func;
                    log.error(err);
                    throw Error(err);
            }
        };

        // We do three types of evaluation here:
        //   1. Evaluation of properties, functions and literals
        //   2. Evaluation related to values that can be numeric or non-numeric
        //   3. Evaluation related to values that can only be numeric
        switch (filter.type) {
            case Constants.Evaluation.PROPERTY:
                return getFromElement(element, filter.name);
            case Constants.Evaluation.LITERAL:
                return filter.value;
            case Constants.Evaluation.FUNCTION_CALL:
                return evaluateF(element, filter.func, filter.args);
        }

        let left = filter.left ? evaluate(element, filter.left) : undefined;
        let right = filter.right ? evaluate(element, filter.right) : undefined;
        switch (filter.type) {
            case Constants.Evaluation.EQUALS:
                // We don't want to force type comparisons in this case.
                return left == right; // eslint-disable-line
            case Constants.Evaluation.NOT_EQUALS:
                // We don't want to force type comparisons in this case.
                return left != right; // eslint-disable-line
            case Constants.Evaluation.AND:
                return left && right;
            case Constants.Evaluation.OR:
                return left || right;
            case Constants.Evaluation.NOT:
                return !left;
            case Constants.Evaluation.ADD:
                return (+left) + (+right);
        }

        left = filter.left ? evaluateN(element, filter.left) : undefined;
        right = filter.right ? evaluateN(element, filter.right) : undefined;
        switch (filter.type) {
            case Constants.Evaluation.LESS_THAN:
                return left < right;
            case Constants.Evaluation.GREATER_THAN:
                return left > right;
            case Constants.Evaluation.LESS_THAN_OR_EQUALS:
                return left <= right;
            case Constants.Evaluation.GREATER_THAN_OR_EQUALS:
                return left >= right;
            case Constants.Evaluation.SUBTRACT:
                return left - right;
            case Constants.Evaluation.MULTIPLY:
                return left * right;
            case Constants.Evaluation.DIVIDE:
                return left / right;
            case Constants.Evaluation.MODULO:
                return left % right;
        }

        // The OData specification is large and we don't support all types of
        // operators/functions
        const err = 'Unable to evaluate unknown type: ' + filter.type;
        log.error(err);
        throw Error(err);
    };

    return d => evaluate(d, filter);
};
