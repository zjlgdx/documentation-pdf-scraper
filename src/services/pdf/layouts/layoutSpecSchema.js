import Joi from 'joi';
import { ValidationError } from '../../../utils/errors.js';
import { lengthToPoints, PDF_LENGTH_PATTERN } from './units.js';

const length = Joi.string().pattern(PDF_LENGTH_PATTERN);
const fontName = Joi.string().trim().min(1).max(120).pattern(/^[\p{L}\p{N} ._-]+$/u);

const zoneSchema = Joi.object({
  top: length.required(),
  bottom: length.required(),
  maxFontSizePt: Joi.number().positive().max(24).required(),
}).unknown(false);

export const layoutSpecSchema = Joi.object({
  id: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required(),
  version: Joi.string().pattern(/^\d+\.\d+\.\d+$/).required(),
  renderer: Joi.string().valid('pandoc-xelatex').required(),
  page: Joi.object({
    width: length.required(),
    height: length.required(),
    margins: Joi.object({
      top: length.required(),
      right: length.required(),
      bottom: length.required(),
      left: length.required(),
    }).unknown(false).required(),
    duplex: Joi.boolean().required(),
  }).unknown(false).required(),
  typography: Joi.object({
    bodyFont: fontName.required(),
    headingFont: fontName.required(),
    monoFont: fontName.required(),
    fontSizePt: Joi.number().positive().max(36).required(),
    lineHeight: Joi.number().min(1).max(2.5).required(),
    headingSizesPt: Joi.object({
      h1: Joi.number().positive().required(),
      h2: Joi.number().positive().required(),
      h3: Joi.number().positive().required(),
    }).unknown(false).required(),
    runningHeaderSizePt: Joi.number().positive().max(18).required(),
    punctuationStyle: Joi.string().valid('kaiming', 'quanjiao', 'banjiao', 'CCT').required(),
  }).unknown(false).required(),
  paragraphs: Joi.object({
    firstLineIndentEm: Joi.number().min(0).max(4).required(),
    spacingEm: Joi.number().min(0).max(3).required(),
  }).unknown(false).required(),
  pagination: Joi.object({
    widowPenalty: Joi.number().integer().min(0).max(10000).required(),
    orphanPenalty: Joi.number().integer().min(0).max(10000).required(),
    displayWidowPenalty: Joi.number().integer().min(0).max(10000).required(),
    raggedBottom: Joi.boolean().required(),
    headingKeepLines: Joi.number().integer().min(2).max(10).required(),
  }).unknown(false).required(),
  furniture: Joi.object({
    runningHeader: Joi.string().valid('section-and-page').required(),
    firstContentPage: Joi.string().valid('footer-only').required(),
    pageNumbering: Joi.string().valid('roman-toc-arabic-body').required(),
    maxMarkEm: Joi.number().positive().max(40).required(),
    headHeight: length.required(),
    headSep: length.required(),
    footSkip: length.required(),
    openingLines: Joi.number().integer().min(0).max(6).required(),
  }).unknown(false).required(),
  content: Joi.object({
    codeFontSizePt: Joi.number().positive().max(18).required(),
    wrapCode: Joi.boolean().required(),
    maxImageWidth: Joi.number().positive().max(1).required(),
    maxTableWidth: Joi.number().positive().max(1).required(),
  }).unknown(false).required(),
  verification: Joi.object({
    requiredFonts: Joi.array().items(Joi.object({
      name: fontName.required(),
      embeddedNames: Joi.array().items(fontName).min(1).unique().required(),
    }).unknown(false)).min(1).unique('name').required(),
    headerZone: zoneSchema.required(),
    footerZone: zoneSchema.required(),
    previewKinds: Joi.array().items(
      Joi.string().valid('toc', 'article-start', 'image', 'code', 'table', 'annotation', 'last')
    ).min(1).unique().required(),
  }).unknown(false).required(),
}).unknown(false);

export function validateLayoutSpec(spec) {
  const { error, value } = layoutSpecSchema.validate(spec, {
    abortEarly: false,
    convert: false,
  });
  if (error) {
    throw new ValidationError(`Invalid PDF layout pack: ${error.details.map((item) => item.message).join('; ')}`);
  }
  const width = lengthToPoints(value.page.width, 'layout page width');
  const height = lengthToPoints(value.page.height, 'layout page height');
  const margins = Object.fromEntries(Object.entries(value.page.margins)
    .map(([side, size]) => [side, lengthToPoints(size, `layout ${side} margin`)]));
  const headerTop = lengthToPoints(value.verification.headerZone.top, 'layout header top');
  const headerBottom = lengthToPoints(value.verification.headerZone.bottom, 'layout header bottom');
  const footerTop = lengthToPoints(value.verification.footerZone.top, 'layout footer top');
  const footerBottom = lengthToPoints(value.verification.footerZone.bottom, 'layout footer bottom');
  if (margins.left + margins.right >= width || margins.top + margins.bottom >= height) {
    throw new ValidationError('Invalid PDF layout pack: margins leave no positive body area');
  }
  if (!(headerTop < headerBottom && headerBottom <= margins.top)) {
    throw new ValidationError('Invalid PDF layout pack: header zone must fit inside the top margin');
  }
  if (!(height - margins.bottom <= footerTop && footerTop < footerBottom && footerBottom <= height)) {
    throw new ValidationError('Invalid PDF layout pack: footer zone must fit inside the bottom margin');
  }
  return value;
}
