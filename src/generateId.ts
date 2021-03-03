import {v1 as uuid} from 'uuid';
import {Id} from './types';

export const generateNewId = (): Id => uuid();
