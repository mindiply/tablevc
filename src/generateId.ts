import cryptoRandomString from 'crypto-random-string';
import {Id} from './types';

export const generateNewId = (idLength = 12): Id =>
  cryptoRandomString({
    length: idLength,
    type: 'url-safe'
  });
