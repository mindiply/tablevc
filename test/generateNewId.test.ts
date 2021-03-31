import {generateNewId} from '../src';

describe('id generation', () => {
  test.each([1, 4, 8, 12, 20, 100, 200, 1000])('Various lengths %i', l => {
    expect((generateNewId(l) as string).length).toBe(l);
  });
  const ids: Set<string> = new Set();
  const iterations: number[] = [];
  for (let i = 0; i < 10000; i++) {
    iterations.push(i + 1);
  }
  test.each(iterations)(
    'Check no duplicates in just 10000 iterations: %i',
    () => {
      const id = generateNewId() as string;
      expect(id.length).toBe(12);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  );
});
