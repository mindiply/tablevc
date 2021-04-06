export enum FilterExpressionType {
  equals = 'equals',
  notEquals = 'notEquals',
  moreThan = 'moreThan',
  moreEquals = 'moreEquals',
  lessThan = 'lessThan',
  lessEquals = 'lessEquals',
  not = 'not',
  functionCall = 'functionCall',
  quotedString = 'quotedString',
  scalar = 'scalar',
  fieldReference = 'fieldReference',
  and = 'and',
  or = 'or'
}

enum EmptyExpressionType {
  empty = 'empty'
}

export type ScalarValue = boolean | number | string;

export interface BaseFilterExpression {
  __typename: string;
}

export interface EqualsFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.equals;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export interface NotEqualsFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.notEquals;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export interface MoreThanFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.moreThan;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export interface MoreEqualsFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.moreEquals;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export interface LessThanFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.lessThan;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export interface LessEqualsFilter extends BaseFilterExpression {
  __typename: FilterExpressionType.lessEquals;
  left: TableFilterExpression;
  right: TableFilterExpression;
}

export type BinaryFilter =
  | EqualsFilter
  | NotEqualsFilter
  | LessEqualsFilter
  | LessThanFilter
  | MoreThanFilter
  | MoreEqualsFilter;

export interface NotFilterExpression extends BaseFilterExpression {
  __typename: FilterExpressionType.not;
  expression: TableFilterExpression;
}

type LogicalOperatorExpression =
  | EqualsFilter
  | NotEqualsFilter
  | MoreEqualsFilter
  | MoreThanFilter
  | LessEqualsFilter
  | LessThanFilter
  | NotFilterExpression;

export interface FunctionFilterExpression extends BaseFilterExpression {
  __typename: FilterExpressionType.functionCall;
  functionName: string;
  parameters: TableFilterExpression[];
}

export interface QuotedStringExpression extends BaseFilterExpression {
  __typename: FilterExpressionType.quotedString;
  text: string;
}

export interface ScalarExpression extends BaseFilterExpression {
  __typename: FilterExpressionType.scalar;
  value: boolean | number | string;
}

export interface FieldReferenceExpression<RecordType = any> {
  __typename: FilterExpressionType.fieldReference;
  fieldReference: keyof RecordType;
}

export interface EmptyFilterExpression extends BaseFilterExpression {
  __typename: EmptyExpressionType;
}

export interface AndFilterExpression<RecordType = any>
  extends BaseFilterExpression {
  __typename: FilterExpressionType.and;
  expressions: TableFilterExpression<RecordType>[];
}

export interface OrFilterExpression<RecordType = any>
  extends BaseFilterExpression {
  __typename: FilterExpressionType.or;
  expressions: TableFilterExpression<RecordType>[];
}

export type TableFilterExpression<
  RecordType = any,
  Ext extends BaseFilterExpression = EmptyFilterExpression
> =
  | LogicalOperatorExpression
  | FunctionFilterExpression
  | QuotedStringExpression
  | ScalarExpression
  | FieldReferenceExpression<RecordType>
  | AndFilterExpression
  | OrFilterExpression
  | Ext;
