/*
 * Deepkit Framework
 * Copyright (C) 2020 Deepkit UG
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { addHook } from 'pirates';
import { CallExpression, Expression, Literal, MemberExpression, ObjectExpression, Property, SpreadElement, UnaryExpression } from 'estree';
import abstractSyntaxTree from 'abstract-syntax-tree';
import { inDebugMode } from '../utils';

const { parse, generate, replace } = abstractSyntaxTree;

export function transform(code: string, filename: string) {
    if (inDebugMode()) return code;
    if (code.indexOf('_jsx(') === -1 && code.indexOf('_jsxs(') === -1) return code;
    const optimized = optimizeJSX(code);
    return optimized;
}

addHook(transform, { exts: ['.js', '.tsx'] });

class NotSerializable {
}

function serializeValue(node: Literal | UnaryExpression): any {
    if (node.type === 'Literal') {
        return node.value;
    }

    if (node.type === 'UnaryExpression' && node.argument?.type === 'Literal') {
        return node.argument.value;
    }

    return NotSerializable;
}

function optimizeAttributes(node: ObjectExpression): any {
    let value: string[] = [];
    for (const p of node.properties) {
        if (p.type === 'SpreadElement') return node;

        const keyName = p.key.type === 'Literal' ? p.key.value : (p.key.type === 'Identifier' ? p.key.name : '');
        if (!keyName) return node;

        if (p.value.type !== 'Literal' && p.value.type !== 'UnaryExpression') return node;

        value.push(keyName + '="' + serializeValue(p.value) + '"');
    }

    return { type: 'Literal', value: value.join(' ') };
}

/**
 *
 * We convert
 *
 * _jsx("div", { id: "123" }, void 0)
 * -> "<div id=\"123\"></div>"
 *
 * _jsx("div", { children: "Test" }, void 0)
 * -> "<div>Test</div>"
 *
 * _jsx("div", Object.assign({ id: "123" }, { children: "Test" }), void 0)
 * -> "<div id=\"123\">Test</div>"
 *
 * _jsx("div", Object.assign({ id: "123" }, { children: _jsx("b", { children: "strong" }, void 0) }), void 0);
 * -> "<div id=\"123\">" + "<b>strong</b>" + "</div>"
 *
 */
function optimizeNode(node: Expression): any {
    if (node.type !== 'CallExpression') return node;
    const isCreateElementExpression = node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === '_jsx'
        && node.callee.property.type === 'Identifier' && node.callee.property?.name === 'createElement';
    if (!isCreateElementExpression) return node;

    //go deeper if possible
    for (let i = 2; i < node.arguments.length; i++) {
        const a = node.arguments[i];
        if (a && a.type === 'CallExpression') {
            node.arguments[i] = optimizeNode(a);
        }
    }

    //can we serialize/optimize attributes?
    //we only optimize attributes when we have createElement(string)
    if (node.arguments[0].type !== 'Literal') return node;
    const tag = node.arguments[0].value;

    if (node.arguments[1] && node.arguments[1].type === 'ObjectExpression') {
        const ori = node.arguments[1];
        node.arguments[1] = optimizeAttributes(ori);
        if (ori === node.arguments[1]) {
            //we did not change the attributes to a better option, so we stop optimizing further.
            return;
        }
    }

    //check if we can consolidate arguments to one big string
    let canBeReplaced = true;
    for (let i = 1; i < node.arguments.length; i++) {
        if (node.arguments[i] && (node.arguments[i].type !== 'Literal' && !isHtmlCall(node.arguments[i]))) {
            canBeReplaced = false;
            break;
        }
    }

    if (canBeReplaced) {
        const args = node.arguments as (Literal | CallExpression)[];
        const attributeLiteral = extractLiteralValue(args[1]);

        let value = '<' + tag + (attributeLiteral ? (' ' + attributeLiteral) : '') + '>';

        for (let i = 2; i < node.arguments.length; i++) {
            if (node.arguments[i] === undefined || node.arguments[i] === null) {
                value += node.arguments[i];
            } else {
                value += extractLiteralValue(args[i]);
            }
        }
        value += '</' + tag + '>';

        return {
            type: 'CallExpression', callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: '_jsx' }, computed: false, property: { type: 'Identifier', name: 'html' }
            }, arguments: [{ type: 'Literal', value: value }]
        };
    }

    return node;
}

function extractLiteralValue(object: Literal | CallExpression) {
    return object.type === 'Literal' ? object.value : (object.arguments[0] && object.arguments[0].type === 'Literal' ? object.arguments[0].value : '');
}

function isHtmlCall(object: Expression | SpreadElement) {
    return object.type === 'CallExpression' && object.callee.type === 'MemberExpression'
        && object.callee.object.type === 'Identifier' && object.callee.object.name === '_jsx'
        && object.callee.property.type === 'Identifier' && object.callee.property.name === 'html'
        && object.arguments[0] && object.arguments[0].type === 'Literal';
}

function extractChildrenFromObjectExpressionProperties(props: Array<Property | SpreadElement>): Expression | undefined {
    for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        if (prop.type === 'Property' && prop.key.type === 'Identifier' && prop.key.name === 'children') {
            props.splice(i, 1);
            return prop.value as Expression;
        }
    }
    return;
}

/**
 * We convert .jsx/.jsxs back to createElement syntax to have one optimization syntax.
 * createElement is used by TSX as well as fallback when `<div {...props} something=123>` is used.
 *
 *
 * _jsx("div", { id: "123" }, void 0)
 * -> _jsx.createElement("div", {id: "123"}}
 *
 * _jsx("div", { children: "Test" }, void 0)
 * -> _jsx.createElement("div", {}, "Test")
 *
 * _jsx("div", Object.assign({ id: "123" }, { children: "Test" }), void 0)
 * -> _jsx.createElement("div", {id: "123"}, "Test"}
 *
 * _jsx("div", Object.assign({ id: "123" }, { children: _jsx("b", { children: "strong" }, void 0) }), void 0);
 * -> _jsx.createElement("div", {id: "123"}, _jsx.createElement("b", {}, "strong"))
 */
function convertNodeToCreateElement(node: Expression): Expression {
    if (node.type !== 'CallExpression') return node;

    const isValid = node.callee.type === 'Identifier' && (node.callee.name === '_jsx' || node.callee.name === '_jsxs');
    if (!isValid) return node;

    //rewrite to _jsx.createElement
    node.callee = {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: '_jsx' }, computed: false, property: { type: 'Identifier', name: 'createElement' }
    } as MemberExpression;

    node.arguments.splice(2); //remove void 0

    if (!node.arguments[1]) return node;

    if (node.arguments[1].type === 'CallExpression' && node.arguments[1].callee.type === 'MemberExpression' && node.arguments[1].callee.object.type === 'Identifier' && node.arguments[1].callee.object.name === 'Object') {
        //Object.assign(), means we have 2 entries, one with attributes, and second with `children`
        // Object.assign({id: 123}, {children: "Test"}) or
        // Object.assign({}, props, { id: "123" }, { children: "Test" })
        const objectAssignsArgs = node.arguments[1].arguments;
        const lastArgument = objectAssignsArgs[objectAssignsArgs.length - 1];

        if (lastArgument.type !== 'ObjectExpression') throw new Error(`Expect ObjectExpression, got ${JSON.stringify(lastArgument)}`);

        const children = extractChildrenFromObjectExpressionProperties(lastArgument.properties);
        if (children) {
            if (children.type === 'ArrayExpression') {
                node.arguments.push(...children.elements.map(v => convertNodeToCreateElement(v as Expression)));
            } else {
                node.arguments.push(convertNodeToCreateElement(children));
            }
        }

        if (objectAssignsArgs.length > 2) {
            //remove last
            objectAssignsArgs.splice(objectAssignsArgs.length - 1, 1);
        } else {
            if (objectAssignsArgs[0].type === 'ObjectExpression') {
                node.arguments[1] = { type: 'ObjectExpression', properties: objectAssignsArgs[0].properties };
            }
        }
    } else if (node.arguments[1].type === 'ObjectExpression') {
        //simple {}
        const children = extractChildrenFromObjectExpressionProperties(node.arguments[1].properties);

        if (children) {
            if (children.type === 'ArrayExpression') {
                node.arguments.push(...children.elements.map(v => convertNodeToCreateElement(v as Expression)));
            } else {
                node.arguments.push(convertNodeToCreateElement(children));
            }
        }
    }

    return node;
}

export function optimizeJSX(code: string): string {
    const tree = parse(code);

    replace(tree, (node: any) => {
        if (node.type === 'CallExpression' && (node.callee.name === '_jsx' || node.callee.name === '_jsxs')) {
            try {
                return optimizeNode(convertNodeToCreateElement(node));
            } catch (error) {
                console.log('failed optimize template node', error);
                console.log('node:', node);
                return node;
            }
        }
        return node;
    });

    return generate(tree);
}

export function convertJsxCodeToCreateElement(code: string): string {
    const tree = parse(code);

    replace(tree, (node: any) => {
        if (node.type === 'CallExpression' && (node.callee.name === '_jsx' || node.callee.name === '_jsxs')) {
            try {
                return convertNodeToCreateElement(node);
            } catch (error) {
                console.log('failed optimize template node', error);
                console.log('node:', node);
                return node;
            }
        }
        return node;
    });

    return generate(tree);
}
