import _ from "underscore";
import {
  parseFunctionName,
  parseDimension,
  parseMetric,
  parseStringLiteral,
  parseIdentifierString,
} from "../expressions";

import { ExpressionCstVisitor, parse } from "./parser";

class ExpressionMBQLCompilerVisitor extends ExpressionCstVisitor {
  constructor(options) {
    super();
    this._options = options;
    this.validateVisitor();
  }

  any(ctx) {
    return this.visit(ctx.expression);
  }

  expression(ctx) {
    return this.visit(ctx.additionExpression);
  }
  aggregation(ctx) {
    return this.visit(ctx.additionExpression);
  }

  additionExpression(ctx) {
    return this._collapsibleOperatorExpression(ctx);
  }
  multiplicationExpression(ctx) {
    return this._collapsibleOperatorExpression(ctx);
  }

  functionExpression(ctx) {
    const functionName = ctx.functionName[0].image;
    const fn = parseFunctionName(functionName);
    if (!fn) {
      throw new Error(`Unknown Function: ${functionName}`);
    }
    const args = (ctx.arguments || []).map(argument => this.visit(argument));
    return [fn, ...args];
  }

  caseExpression(ctx) {
    const mbql = [
      "case",
      ctx.filter.map((f, i) => [this.visit(f), this.visit(ctx.expression[i])]),
    ];
    if (ctx.default) {
      mbql.push({ default: this.visit(ctx.default) });
    }
    return mbql;
  }

  metricExpression(ctx) {
    const metricName = this.visit(ctx.metricName);
    const metric = parseMetric(metricName, this._options.query);
    if (!metric) {
      throw new Error(`Unknown Metric: ${metricName}`);
    }
    return ["metric", metric.id];
  }
  dimensionExpression(ctx) {
    const dimensionName = this.visit(ctx.dimensionName);
    const dimension = parseDimension(dimensionName, this._options.query);
    if (!dimension) {
      throw new Error(`Unknown Field: ${dimensionName}`);
    }
    return dimension.mbql();
  }

  identifier(ctx) {
    return ctx.Identifier[0].image;
  }
  identifierString(ctx) {
    return parseIdentifierString(ctx.IdentifierString[0].image);
  }
  stringLiteral(ctx) {
    return parseStringLiteral(ctx.StringLiteral[0].image);
  }
  numberLiteral(ctx) {
    return parseFloat(ctx.NumberLiteral[0].image) * (ctx.Minus ? -1 : 1);
  }
  atomicExpression(ctx) {
    return this.visit(ctx.expression);
  }
  parenthesisExpression(ctx) {
    return this.visit(ctx.expression);
  }

  // FILTERS
  filter(ctx) {
    return this.visit(ctx.booleanExpression);
  }
  booleanExpression(ctx) {
    return this._collapsibleOperatorExpression(ctx);
  }
  filterOperatorExpression(ctx) {
    const operator = ctx.operator[0].image.toLowerCase();
    const lhs = this.visit(ctx.lhs);
    const rhs = this.visit(ctx.rhs);
    return [operator, lhs, rhs];
  }

  // HELPERS:

  _collapsibleOperatorExpression(ctx) {
    let initial = this.visit(ctx.lhs);
    if (ctx.rhs) {
      for (const index of ctx.rhs.keys()) {
        const operator = ctx.operator[index].image.toLowerCase();
        const operand = this.visit(ctx.rhs[index]);
        // collapse multiple consecutive operators into a single MBQL statement
        if (Array.isArray(initial) && initial[0] === operator) {
          initial.push(operand);
        } else {
          initial = [operator, initial, operand];
        }
      }
    }
    return initial;
  }
}

export function compile(source, options = {}) {
  if (!source) {
    return [];
  }
  const cst = parse(source, options);
  const vistor = new ExpressionMBQLCompilerVisitor(options);
  return vistor.visit(cst);
}