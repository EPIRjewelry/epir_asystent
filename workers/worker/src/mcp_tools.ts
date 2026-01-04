/**
 * worker/src/mcp_tools.ts
 * 
 * Definicje narzędzi MCP zgodne z:
 * - OpenAI function-calling: https://platform.openai.com/docs/guides/function-calling
 * - Shopify Storefront MCP: https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront
 * 
 * UWAGA: Tylko oficjalne narzędzia Shopify Storefront MCP!
 * - search_shop_catalog
 * - search_shop_policies_and_faqs
 * - get_cart
 * - update_cart
 */

/**
 * JSON Schema definitions for Shopify Storefront MCP tools.
 * Format zgodny z OpenAI function-calling.
 */
export const TOOL_SCHEMAS = {
  search_shop_catalog: {
    name: 'search_shop_catalog',
    description: 'Search Shopify product catalog using natural language or keywords. Returns product details including name, price, URL, image, and description.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords, product name, category, etc.)'
        },
        context: {
          type: 'string',
          description: 'Additional context to help tailor results (e.g., "Customer prefers silver jewelry")'
        }
      },
      required: ['query', 'context']
    }
  },

  search_shop_policies_and_faqs: {
    name: 'search_shop_policies_and_faqs',
    description: 'Answer questions about the store\'s policies, products, and services. Use for questions about shipping, returns, refunds, FAQs, and store information.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question about policies or FAQs'
        },
        context: {
          type: 'string',
          description: 'Additional context like current product (optional)'
        }
      },
      required: ['query']
    }
  },

  get_cart: {
    name: 'get_cart',
    description: 'Retrieve current shopping cart contents, including item details and checkout URL.',
    parameters: {
      type: 'object',
      properties: {
        cart_id: {
          type: 'string',
          description: 'ID of an existing cart (e.g., gid://shopify/Cart/abc123def456)'
        }
      },
      required: ['cart_id']
    }
  },

  update_cart: {
    name: 'update_cart',
    description: 'Update quantities of items in an existing cart or add new items. Creates a new cart if no cart_id is provided. Set quantity to 0 to remove an item.',
    parameters: {
      type: 'object',
      properties: {
        cart_id: {
          type: ['string', 'null'],
          description: 'ID of the cart to update. Creates a new cart if not provided.'
        },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line_item_id: {
                type: 'string',
                description: 'ID of existing cart line to update (e.g., gid://shopify/CartLine/line2)'
              },
              merchandise_id: {
                type: 'string',
                description: 'Product variant ID (e.g., gid://shopify/ProductVariant/789012)'
              },
              quantity: {
                type: 'number',
                description: 'Quantity to set (0 to remove)',
                minimum: 0
              }
            },
            required: ['quantity']
          },
          description: 'Array of cart line items to update or add'
        }
      },
      required: ['lines']
    }
  }
};

/**
 * Returns tool schemas as array for OpenAI function-calling format.
 */
export function getToolDefinitions() {
  return Object.values(TOOL_SCHEMAS).map((schema) => ({
    type: 'function' as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

/**
 * Returns all tool schemas as JSON string (for embedding in system message if needed).
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
