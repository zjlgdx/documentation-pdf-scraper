import { describe, expect, it } from 'vitest';
import { createAnnotationResponseSchema } from '../../src/services/annotationContract.js';

describe('annotation response schema', () => {
  it('uses only Gemini-supported structured-output constraints', () => {
    const schema = createAnnotationResponseSchema(2, 12);
    const serialized = JSON.stringify(schema);

    expect(serialized).not.toContain('minLength');
    expect(serialized).not.toContain('maxLength');
    expect(schema.properties.segments).toMatchObject({ minItems: 12, maxItems: 12 });
    expect(schema.properties.segments.items.properties.annotations.maxItems).toBe(2);
  });
});
