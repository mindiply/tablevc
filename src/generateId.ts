import randombytes from 'randombytes';
import {Id} from './types';

const numbers = '0123456789';
const charsLower = 'abcdefghijklmnopqrstuvwxyz';
const charset = `${numbers}${charsLower}${charsLower.toUpperCase()}_`;
const MAX_CHARSET_SIZE = 0x10000;

export const generateNewId = (idLength = 12): Id => {
  const result: string[] = [];
  const max = MAX_CHARSET_SIZE - (MAX_CHARSET_SIZE % charset.length);

  while (result.length < idLength) {
    // Ensure that the size of entropy is even because we are using 2 bytes
    // for getting selectors. We use 16bit selectors so that it would allow
    // generating random strings from bigger character sets.
    // The size of entropy is also set to be a little longer than the requested
    // length so that we have higher chances of generating the compelete string
    // in one loop.
    const entropy = randombytes(Math.ceil(1.1 * idLength) * 2);

    for (let i = 0; i < entropy.length && result.length < idLength; i += 2) {
      const selector = entropy.readUInt16BE(i);
      if (selector > max) {
        continue;
      }
      result.push(charset[selector % charset.length]);
    }
  }
  return result.join('');
};
