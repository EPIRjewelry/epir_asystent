/**
 * worker/src/mcp_tools.ts
 * Definicje narzędzi MCP (JSON Schema) zgodne z OpenAI function-calling i MCP spec.
 * Walidacja wywołań narzędzi przed wykonaniem.
 * 
 * Zgodność z dokumentacją:
 * - OpenAI function-calling: https://platform.openai.com/docs/guides/function-calling
 * - Shopify MCP: narzędzia introspect_graphql_schema, validate_graphql_codeblocks, validate_theme_codeblocks, validate_component_codeblocks
 * - Harmony format: system message zawiera pełne JSON schemas dla wszystkich narzędzi
 */

/**
 * JSON Schema definitions for MCP tools.
 * These are embedded in the system message to allow the LLM to generate valid tool calls.
 */
export const TOOL_SCHEMAS = {
  introspect_graphql_schema: {
    name: 'introspect_graphql_schema',
    description: 'Returns available types, queries, mutations and fields for the shop\'s GraphQL schema. Always use this before generating GraphQL code to avoid hallucinations.',
    parameters: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'GraphQL endpoint URL (e.g., https://shop.myshopify.com/admin/api/2024-07/graphql.json)'
        },
        auth: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'Shopify Admin API access token' }
          },
          required: ['token']
        },
        includeExtensions: {
          type: 'boolean',
          description: 'Include GraphQL extensions (directives, etc.) in introspection result',
          default: false
        }
      },
      required: ['endpoint']
    }
  },

  validate_graphql_codeblocks: {
    name: 'validate_graphql_codeblocks',
    description: 'Validates provided GraphQL queries/mutations against a given schema. Use this to ensure generated GraphQL code is correct before returning to user.',
    parameters: {
      type: 'object',
      properties: {
        schemaSnapshotId: {
          type: 'string',
          description: 'Schema snapshot ID from introspection (used to cache schema for performance)'
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of GraphQL query/mutation strings to validate'
        }
      },
      required: ['schemaSnapshotId', 'queries']
    }
  },

  validate_theme_codeblocks: {
    name: 'validate_theme_codeblocks',
    description: 'Validates Liquid/JSON/CSS files for syntax correctness and referencing components. Use for theme customization and app blocks.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path (e.g., sections/header.liquid)' },
              content: { type: 'string', description: 'File content to validate' }
            },
            required: ['path', 'content']
          },
          description: 'Array of theme files to validate'
        },
        validationMode: {
          type: 'string',
          enum: ['partial', 'full'],
          description: 'Validation mode: partial (syntax only) or full (syntax + component references)',
          default: 'partial'
        }
      },
      required: ['files']
    }
  },

  validate_component_codeblocks: {
    name: 'validate_component_codeblocks',
    description: 'Validates JS/TS component snippets for correct props and allowed component usage. Use for React/UI extensions.',
    parameters: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of allowed component names (e.g., ["Button", "TextField", "Card"])'
        },
        codeSnippets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of code snippets to validate'
        }
      },
      required: ['codeSnippets']
    }
  },

  search_shop_catalog: {
    name: 'search_shop_catalog',
    description: 'Search Shopify product catalog using natural language or keywords. Returns product details for answering customer queries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords, product name, category, etc.)'
        },
        context: {
          type: 'string',
          description: 'Domain context for disambiguation (e.g., "biżuteria" or intent from the conversation)'
        },
        first: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 20)',
          default: 5,
          minimum: 1,
          maximum: 20
        }
      },
      required: ['query', 'context']
    }
  },

  get_cart: {
    name: 'get_cart',
    description: 'Retrieve current shopping cart contents for a given cart ID.',
    parameters: {
      type: 'object',
      properties: {
        cart_id: {
          type: 'string',
          description: 'Cart ID to retrieve'
        }
      },
      required: ['cart_id']
    }
  },

  update_cart: {
    name: 'update_cart',
    description: 'Add, remove, or update items in the shopping cart. Returns updated cart.',
    parameters: {
      type: 'object',
      properties: {
        cart_id: {
          type: ['string', 'null'],
          description: 'Cart ID (null to create new cart)'
        },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              merchandiseId: {
                type: 'string',
                description: 'Product variant ID (gid://shopify/ProductVariant/...)'
              },
              quantity: {
                type: 'number',
                description: 'Quantity to add/update (0 to remove)',
                minimum: 0
              }
            },
            required: ['merchandiseId', 'quantity']
          },
          description: 'Array of cart line items to update'
        }
      },
      required: ['lines']
    }
  },

  get_order_status: {
    name: 'get_order_status',
    description: 'Get status and details of a specific order by ID.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'Order ID to check'
        }
      },
      required: ['order_id']
    }
  },

  get_most_recent_order_status: {
    name: 'get_most_recent_order_status',
    description: 'Get status of the most recent order for the current customer.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
};

/**
 * Returns all tool schemas as JSON string (for embedding in system message).
 */
export function getToolSchemasJson(): string {
  return JSON.stringify(Object.values(TOOL_SCHEMAS), null, 2);
}

/**
 * Validates function call arguments against the tool's JSON schema.
 * Returns { ok: true } if valid, { ok: false, errors: [...] } if invalid.
 * 
 * Note: This is a basic runtime validation. For production, consider using
 * a full JSON Schema validator like Ajv.
 */
export function validateFunctionSignature(
  toolName: string,
  args: any
): { ok: boolean; errors?: string[] } {
  const schema = TOOL_SCHEMAS[toolName as keyof typeof TOOL_SCHEMAS];
  
  if (!schema) {
    return { ok: false, errors: [`Unknown tool: ${toolName}`] };
  }

  const errors: string[] = [];
  const params = schema.parameters as any; // Type assertion for JSON Schema flexibility

  // Check required parameters
  if (params.required && Array.isArray(params.required)) {
    for (const requiredParam of params.required) {
      if (!(requiredParam in args)) {
        errors.push(`Missing required parameter: ${requiredParam}`);
      }
    }
  }

  // Basic type checking for known properties
  if (params.properties && typeof params.properties === 'object') {
    for (const [key, propSchema] of Object.entries(params.properties)) {
      if (key in args) {
        const value = args[key];
        const prop = propSchema as any;

        // Type validation
        if (prop.type) {
          const expectedTypes = Array.isArray(prop.type) ? prop.type : [prop.type];
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          
          if (!expectedTypes.includes(actualType) && !expectedTypes.includes('null') || (value === null && !expectedTypes.includes('null'))) {
            errors.push(`Invalid type for ${key}: expected ${expectedTypes.join(' or ')}, got ${actualType}`);
          }

          // Array item validation
          if (actualType === 'array' && prop.items) {
            for (let i = 0; i < value.length; i++) {
              const item = value[i];
              const itemType = typeof item;
              const expectedItemType = prop.items.type;

              if (expectedItemType && itemType !== expectedItemType && !(item === null && expectedItemType === 'null')) {
                errors.push(`Invalid type for ${key}[${i}]: expected ${expectedItemType}, got ${itemType}`);
              }

              // Object item property validation (e.g., cart lines)
              if (itemType === 'object' && prop.items.properties) {
                const itemRequired = prop.items.required || [];
                for (const reqKey of itemRequired) {
                  if (!(reqKey in item)) {
                    errors.push(`Missing required property ${reqKey} in ${key}[${i}]`);
                  }
                }

                // Type validation for object properties (e.g., quantity must be number)
                for (const [propKey, propValue] of Object.entries(prop.items.properties)) {
                  if (propKey in item) {
                    const propSchema = propValue as any;
                    const actualPropType = typeof item[propKey];
                    const expectedPropType = propSchema.type;

                    if (expectedPropType && actualPropType !== expectedPropType && !(item[propKey] === null && expectedPropType === 'null')) {
                      errors.push(`Invalid type for ${key}[${i}].${propKey}: expected ${expectedPropType}, got ${actualPropType}`);
                    }
                  }
                }
              }
            }
          }

          // Enum validation
          if (prop.enum && !prop.enum.includes(value)) {
            errors.push(`Invalid value for ${key}: expected one of ${prop.enum.join(', ')}, got ${value}`);
          }

          // Number range validation
          if (prop.minimum !== undefined && typeof value === 'number' && value < prop.minimum) {
            errors.push(`Value for ${key} is below minimum: ${value} < ${prop.minimum}`);
          }
          if (prop.maximum !== undefined && typeof value === 'number' && value > prop.maximum) {
            errors.push(`Value for ${key} exceeds maximum: ${value} > ${prop.maximum}`);
          }
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validates and executes a tool call.
 * Returns the tool result or an error object.
 * 
 * @param toolName - Name of the tool to execute
 * @param args - Arguments for the tool
 * @param executeToolFn - Function that executes the tool (injected for testability)
 * @returns Tool result or error
 */
export async function executeToolValidated(
  toolName: string,
  args: any,
  executeToolFn: (name: string, args: any) => Promise<any>
): Promise<{ ok: boolean; result?: any; error?: { code: number; message: string; details?: any } }> {
  // Step 1: Validate arguments
  const validation = validateFunctionSignature(toolName, args);
  
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: -32602,
        message: 'Invalid tool arguments',
        details: { errors: validation.errors }
      }
    };
  }

  // Step 2: Execute tool
  try {
    const result = await executeToolFn(toolName, args);
    return { ok: true, result };
  } catch (err: any) {
    console.error(`[mcp_tools] Tool execution failed: ${toolName}`, err);
    return {
      ok: false,
      error: {
        code: -32000,
        message: 'Tool execution failed',
        details: { message: err.message || String(err) }
      }
    };
  }
}
