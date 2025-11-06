/**
 * worker/src/shopify-mcp-full-client.ts
 *
 * Full-featured MCP Client for Cloudflare Workers.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 * Ported from shop-chat-agent/app/mcp-client.js
 */

interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  id: number;
  params: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface ToolCallResult {
  error?: {
    type: string;
    data: string;
  };
  [key: string]: any;
}

export class ShopifyMCPFullClient {
  private tools: Tool[] = [];
  private customerTools: Tool[] = [];
  private storefrontTools: Tool[] = [];
  private storefrontMcpEndpoint: string;
  private customerMcpEndpoint: string;
  private customerAccessToken: string = '';
  private conversationId: string;
  private shopId: string;

  /**
   * Creates a new ShopifyMCPFullClient instance.
   *
   * @param hostUrl - The base URL for the shop (e.g., "https://example.myshopify.com")
   * @param conversationId - ID for the current conversation
   * @param shopId - ID of the Shopify shop
   * @param customerMcpEndpoint - Optional custom customer MCP endpoint
   */
  constructor(
    hostUrl: string,
    conversationId: string,
    shopId: string,
    customerMcpEndpoint?: string
  ) {
    // Storefront endpoint
    this.storefrontMcpEndpoint = `${hostUrl}/api/mcp`;

    // Customer endpoint - convert myshopify.com to account.myshopify.com
    const accountHostUrl = hostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;

    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @param getTokenFn - Optional function to retrieve customer access token from storage
   * @returns Array of available customer tools
   */
  async connectToCustomerServer(
    getTokenFn?: (conversationId: string) => Promise<string | null>
  ): Promise<Tool[]> {
    try {
      console.log(`Connecting to customer MCP server at ${this.customerMcpEndpoint}`);

      // Try to get token if function provided
      if (this.conversationId && getTokenFn) {
        const dbToken = await getTokenFn(this.conversationId);
        if (dbToken) {
          this.customerAccessToken = dbToken;
        } else {
          console.log('No token found for conversation:', this.conversationId);
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: this.customerAccessToken || '',
      };

      const response = await this.makeJsonRpcRequest(
        this.customerMcpEndpoint,
        'tools/list',
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result?.tools || [];
      const customerTools = this.formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      return customerTools;
    } catch (e) {
      console.error('Failed to connect to customer MCP server:', e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns Array of available storefront tools
   */
  async connectToStorefrontServer(): Promise<Tool[]> {
    try {
      console.log(`Connecting to storefront MCP server at ${this.storefrontMcpEndpoint}`);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const response = await this.makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        'tools/list',
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result?.tools || [];
      const storefrontTools = this.formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      return storefrontTools;
    } catch (e) {
      console.error('Failed to connect to storefront MCP server:', e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param toolName - Name of the tool to call
   * @param toolArgs - Arguments to pass to the tool
   * @param getTokenFn - Optional function to retrieve customer access token
   * @param generateAuthUrlFn - Optional function to generate auth URL for customer tools
   * @returns Result from the tool call
   */
  async callTool(
    toolName: string,
    toolArgs: Record<string, any>,
    getTokenFn?: (conversationId: string) => Promise<string | null>,
    generateAuthUrlFn?: (conversationId: string, shopId: string) => Promise<{ url: string }>
  ): Promise<ToolCallResult> {
    if (this.customerTools.some((tool) => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs, getTokenFn, generateAuthUrlFn);
    } else if (this.storefrontTools.some((tool) => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param toolName - Name of the storefront tool to call
   * @param toolArgs - Arguments to pass to the tool
   * @returns Result from the tool call
   */
  async callStorefrontTool(toolName: string, toolArgs: Record<string, any>): Promise<ToolCallResult> {
    try {
      console.log('Calling storefront tool', toolName, toolArgs);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const response = await this.makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        'tools/call',
        {
          name: toolName,
          arguments: toolArgs,
        },
        headers
      );

      return response.result || response;
    } catch (error: any) {
      console.error(`Error calling storefront tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param toolName - Name of the customer tool to call
   * @param toolArgs - Arguments to pass to the tool
   * @param getTokenFn - Optional function to retrieve customer access token
   * @param generateAuthUrlFn - Optional function to generate auth URL
   * @returns Result from the tool call or auth error
   */
  async callCustomerTool(
    toolName: string,
    toolArgs: Record<string, any>,
    getTokenFn?: (conversationId: string) => Promise<string | null>,
    generateAuthUrlFn?: (conversationId: string, shopId: string) => Promise<{ url: string }>
  ): Promise<ToolCallResult> {
    try {
      console.log('Calling customer tool', toolName, toolArgs);

      // Try to get a token
      let accessToken = this.customerAccessToken;

      if (!accessToken && getTokenFn) {
        const dbToken = await getTokenFn(this.conversationId);
        if (dbToken) {
          accessToken = dbToken;
          this.customerAccessToken = accessToken;
        } else {
          console.log('No token in storage for conversation:', this.conversationId);
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: accessToken,
      };

      try {
        const response = await this.makeJsonRpcRequest(
          this.customerMcpEndpoint,
          'tools/call',
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        return response.result || response;
      } catch (error: any) {
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          console.log('Unauthorized, generating authorization URL for customer');

          if (generateAuthUrlFn) {
            // Generate auth URL
            const authResponse = await generateAuthUrlFn(this.conversationId, this.shopId);

            // Return the auth URL for the front-end
            return {
              error: {
                type: 'auth_required',
                data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`,
              },
            };
          } else {
            return {
              error: {
                type: 'auth_required',
                data: 'Authentication required but no auth URL generator provided.',
              },
            };
          }
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error: any) {
      console.error(`Error calling customer tool ${toolName}:`, error);
      return {
        error: {
          type: 'internal_error',
          data: `Error calling tool ${toolName}: ${error.message}`,
        },
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @param endpoint - The endpoint URL
   * @param method - The JSON-RPC method to call
   * @param params - Parameters for the method
   * @param headers - HTTP headers for the request
   * @returns Parsed JSON response
   */
  private async makeJsonRpcRequest(
    endpoint: string,
    method: string,
    params: Record<string, any>,
    headers: Record<string, string>
  ): Promise<JsonRpcResponse> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: method,
      id: 1,
      params: params,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error: any = new Error(`Request failed: ${response.status} ${errorText}`);
      error.status = response.status;
      throw error;
    }

    return (await response.json()) as JsonRpcResponse;
  }

  /**
   * Formats raw tool data into a consistent format.
   *
   * @param toolsData - Raw tools data from the API
   * @returns Formatted tools data
   */
  private formatToolsData(toolsData: any[]): Tool[] {
    return toolsData.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || tool.input_schema,
    }));
  }

  /**
   * Gets all available tools (customer + storefront).
   */
  getTools(): Tool[] {
    return this.tools;
  }

  /**
   * Gets customer-specific tools.
   */
  getCustomerTools(): Tool[] {
    return this.customerTools;
  }

  /**
   * Gets storefront-specific tools.
   */
  getStorefrontTools(): Tool[] {
    return this.storefrontTools;
  }
}
