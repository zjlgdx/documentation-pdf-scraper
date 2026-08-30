export const ANNOTATION_CONTRACT_VERSION = '2.0.0';
export const ANNOTATION_RENDER_VERSION = '1.1.2';

export const ANNOTATION_TYPES = [
  'word',
  'phrasal-verb',
  'idiom',
  'collocation',
  'native-expression',
  'technical-term',
  'slang',
  'grammar-pattern',
  'discourse-logic',
  'register-usage',
  'writing-pattern',
  'concept',
];

export const ANNOTATION_DENSITY_LIMITS = {
  light: 1,
  standard: 2,
  dense: 3,
};

export function createAnnotationResponseSchema(maxAnnotations, segmentCount) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['segments'],
    properties: {
      segments: {
        type: 'array',
        minItems: segmentCount,
        maxItems: segmentCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['segmentId', 'annotations'],
          properties: {
            segmentId: { type: 'string' },
            annotations: {
              type: 'array',
              maxItems: maxAnnotations,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'quote',
                  'occurrence',
                  'type',
                  'explanationZh',
                  'exampleEn',
                  'learningPromptZh',
                ],
                properties: {
                  quote: { type: 'string' },
                  occurrence: { type: 'integer', minimum: 1 },
                  type: { type: 'string', enum: ANNOTATION_TYPES },
                  explanationZh: { type: 'string' },
                  exampleEn: { type: 'string' },
                  learningPromptZh: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}
