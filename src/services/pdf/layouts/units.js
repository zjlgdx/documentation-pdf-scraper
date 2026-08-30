import { ValidationError } from '../../../utils/errors.js';

export const PDF_LENGTH_PATTERN = /^(?:0|[1-9]\d*(?:\.\d+)?|0\.\d+)(?:mm|cm|in|pt|px)$/;

const POINTS_PER_UNIT = {
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
  pt: 1,
  px: 0.75,
};

export function lengthToPoints(value, label = 'PDF length') {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/);
  if (!match) throw new ValidationError(`Unsupported ${label}: ${value}`);
  return Number(match[1]) * POINTS_PER_UNIT[match[2]];
}
