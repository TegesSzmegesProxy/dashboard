import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  HTTP_METHODS,
  POLICY_SCHEMA_VERSION,
  StructuredPolicyV1Dto,
} from '../../policy/v1/policy.contract.js';

/**
 * Structured output requested from the AI provider when generating or
 * editing a policy. The JSON schema constrains generation; the DTO below
 * re-validates the result because AI output is untrusted input. Compilation
 * against the tool registry happens afterwards.
 */
export const AI_POLICY_SCHEMA_VERSION = 'tessera.ai-policy/v1' as const;

/** Shown with every AI-generated or AI-edited policy version. */
export const NATURAL_LANGUAGE_PRECISION_WARNING =
  'This policy was produced by an AI model from natural language. ' +
  'Natural language is imprecise: the structured policy may be stricter, ' +
  'looser or different from what was intended, and requests the tool ' +
  'registry cannot express are omitted. Review the structured policy and ' +
  'its changes before approving it; approval, not the text, defines what ' +
  'the proxy enforces.';

export class AiPolicyOutputDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(10_000)
  humanReadableIntent!: string;

  @ValidateNested()
  @Type(() => StructuredPolicyV1Dto)
  structuredPolicy!: StructuredPolicyV1Dto;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  limitations!: string[];
}

/**
 * Structured outputs do not support optional properties reliably or numeric
 * bounds, so bounds are nullable here and `null` is removed before
 * validation. Range checks happen in the DTO and the compiler.
 */
export const AI_POLICY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    humanReadableIntent: { type: 'string' },
    structuredPolicy: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'string', enum: [POLICY_SCHEMA_VERSION] },
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              method: { type: 'string', enum: [...HTTP_METHODS] },
              path: { type: 'string' },
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    toolId: { type: 'string', enum: ['string_length'] },
                    target: { type: 'string' },
                    config: {
                      type: 'object',
                      properties: {
                        minLength: { type: ['integer', 'null'] },
                        maxLength: { type: ['integer', 'null'] },
                      },
                      required: ['minLength', 'maxLength'],
                      additionalProperties: false,
                    },
                  },
                  required: ['toolId', 'target', 'config'],
                  additionalProperties: false,
                },
              },
            },
            required: ['method', 'path', 'tools'],
            additionalProperties: false,
          },
        },
      },
      required: ['schemaVersion', 'endpoints'],
      additionalProperties: false,
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['humanReadableIntent', 'structuredPolicy', 'limitations'],
  additionalProperties: false,
};

/**
 * Removes `null` tool bounds so the output matches the policy contract,
 * where an absent bound means "not constrained". Anything unexpected is left
 * untouched for validation to reject.
 */
export function normalizeAiPolicyOutput(output: unknown): unknown {
  if (!isRecord(output) || !isRecord(output.structuredPolicy)) return output;
  const endpoints = output.structuredPolicy.endpoints;
  if (!Array.isArray(endpoints)) return output;
  return {
    ...output,
    structuredPolicy: {
      ...output.structuredPolicy,
      endpoints: endpoints.map((endpoint: unknown) => {
        if (!isRecord(endpoint) || !Array.isArray(endpoint.tools)) {
          return endpoint;
        }
        return {
          ...endpoint,
          tools: endpoint.tools.map((tool: unknown) => {
            if (!isRecord(tool) || !isRecord(tool.config)) return tool;
            return {
              ...tool,
              config: Object.fromEntries(
                Object.entries(tool.config).filter(
                  ([, value]) => value !== null,
                ),
              ),
            };
          }),
        };
      }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
