import {
  AndFilterExpression,
  BinaryFilter,
  EqualsFilter,
  FieldReferenceExpression,
  FilterExpressionType,
  FunctionFilterExpression,
  LessEqualsFilter,
  LessThanFilter,
  MoreThanFilter,
  NotEqualsFilter,
  NotFilterExpression,
  OrFilterExpression,
  QuotedStringExpression,
  ScalarExpression,
  TableFilterExpression
} from './tableFiltersTypes';

export function isTableFilterExpression(
  obj: any
): obj is TableFilterExpression {
  return obj && typeof obj === 'object' && typeof obj.__typename === 'string';
}

export function isBinaryFilter(obj: any): obj is BinaryFilter {
  return (
    (isTableFilterExpression(obj) as boolean) &&
    isTableFilterExpression(obj.left) &&
    isTableFilterExpression(obj.right)
  );
}

export const equals = (
  left: TableFilterExpression,
  right: TableFilterExpression
): EqualsFilter => ({
  __typename: FilterExpressionType.equals,
  left,
  right
});

export const notEquals = (
  left: TableFilterExpression,
  right: TableFilterExpression
): NotEqualsFilter => ({
  __typename: FilterExpressionType.notEquals,
  left,
  right
});

export const moreThan = (
  left: TableFilterExpression,
  right: TableFilterExpression
): MoreThanFilter => ({
  __typename: FilterExpressionType.moreThan,
  left,
  right
});

export const moreEquals = (
  left: TableFilterExpression,
  right: TableFilterExpression
): MoreThanFilter => ({
  __typename: FilterExpressionType.moreThan,
  left,
  right
});

export const lessThan = (
  left: TableFilterExpression,
  right: TableFilterExpression
): LessThanFilter => ({
  __typename: FilterExpressionType.lessThan,
  left,
  right
});

export const lessEquals = (
  left: TableFilterExpression,
  right: TableFilterExpression
): LessEqualsFilter => ({
  __typename: FilterExpressionType.lessEquals,
  left,
  right
});

export const not = <Ext = any>(
  expression: TableFilterExpression<Ext>
): NotFilterExpression => ({
  __typename: FilterExpressionType.not,
  expression
});

export const functionCall = (
  functionName: string,
  parameters: TableFilterExpression[] = []
): FunctionFilterExpression => ({
  __typename: FilterExpressionType.functionCall,
  functionName,
  parameters
});

export const quotedStr = (text: string): QuotedStringExpression => ({
  __typename: FilterExpressionType.quotedString,
  text
});

export const scalarValue = (
  value: number | boolean | string
): ScalarExpression => ({
  __typename: FilterExpressionType.scalar,
  value
});

export const fieldReference = <RecordType = any>(
  field: keyof RecordType
): FieldReferenceExpression<RecordType> => ({
  __typename: FilterExpressionType.fieldReference,
  fieldReference: field
});

export function and(...filters: TableFilterExpression[]): AndFilterExpression;
export function and(filters: TableFilterExpression[]): AndFilterExpression;
export function and(
  first: TableFilterExpression | TableFilterExpression[],
  ...other: TableFilterExpression[]
): AndFilterExpression {
  const filters = Array.isArray(first) ? first : [first, ...other];
  return {
    __typename: FilterExpressionType.and,
    expressions: filters
  };
}

export function or(...filters: TableFilterExpression[]): OrFilterExpression;
export function or(filters: TableFilterExpression[]): OrFilterExpression;
export function or(
  first: TableFilterExpression | TableFilterExpression[],
  ...other: TableFilterExpression[]
): OrFilterExpression {
  const filters = Array.isArray(first) ? first : [first, ...other];
  return {
    __typename: FilterExpressionType.or,
    expressions: filters
  };
}
