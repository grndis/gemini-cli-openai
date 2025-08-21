const { 
  CODE_ASSIST_ENDPOINT, 
  CODE_ASSIST_API_VERSION,
  TOKEN_REFRESH_BUFFER_MS
} = require('../config');

const { initializeAuth: googleInitializeAuth, getGeminiDir } = require('./google-auth');
const { AuthType } = require('@google/gemini-cli-core/dist/src/core/contentGenerator.js');

/**
 * Initialize authentication using OAuth2 credentials with token caching.
 */
async function initializeAuth(accountId = 'default') {
  try {
    // Use the new Google Auth implementation
    const accessToken = await googleInitializeAuth(accountId);
    return accessToken;
  } catch (error) {
    console.error('Authentication failed:', error.message);
    throw error;
  }
}

/**
 * Refresh the OAuth token and cache it.
 */
async function refreshAndCacheToken(accountId, refreshToken) {
  try {
    // Use the new Google Auth implementation
    const { refreshAndCacheToken } = require('./google-auth');
    return await refreshAndCacheToken(accountId, refreshToken);
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    throw error;
  }
}

/**
 * Discovers the Google Cloud project ID. Uses the environment variable if provided.
 */
async function discoverProjectId(accessToken) {
  if (process.env.GEMINI_PROJECT_ID) {
    return process.env.GEMINI_PROJECT_ID;
  }

  try {
    // For OAuth personal authentication, we don't need a project ID
    // as we're using the direct Gemini API
    const authType = process.env.AUTH_TYPE || AuthType.LOGIN_WITH_GOOGLE;
    
    if (authType === AuthType.LOGIN_WITH_GOOGLE) {
      // For personal OAuth, we don't need a project ID
      return null;
    }

    const initialProjectId = "default-project";
    const loadResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        cloudaicompanionProject: initialProjectId,
        metadata: { duetProject: initialProjectId }
      })
    });

    if (loadResponse.ok) {
      const data = await loadResponse.json();
      if (data.cloudaicompanionProject) {
        return data.cloudaicompanionProject;
      }
    }
    
    // If discovery fails, fall back to default
    console.log("Project ID discovery failed, using default project ID");
    return "default-project";
  } catch (error) {
    console.error("Failed to discover project ID:", error.message);
    // Fall back to default project ID
    return "default-project";
  }
}

/**
 * Convert OpenAI tools format to Gemini tools format
 */
function convertToolsToGeminiFormat(tools) {
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  // Check if all tools are search-like tools
  const searchToolNames = ['search', 'web_search', 'google_search', 'find', 'lookup', 'query'];
  const allSearchTools = tools.every(tool => 
    searchToolNames.some(searchName => 
      tool.function.name.toLowerCase().includes(searchName)
    )
  );

  if (allSearchTools) {
    // If all tools are search tools, we can send them all in one tool
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || {}
      }))
    }];
  } else {
    // If not all search tools, send them as separate tools (but limit to first few)
    // Gemini API has limitations on mixed tool types
    const limitedTools = tools.slice(0, 1); // Only send the first tool for non-search tools
    return limitedTools.map(tool => ({
      functionDeclarations: [{
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || {}
      }]
    }));
  }
}

/**
 * Convert tool_choice to Gemini format
 */
function convertToolChoiceToGeminiFormat(toolChoice) {
  if (!toolChoice) {
    return undefined;
  }

  if (toolChoice === 'none') {
    return { functionCallingConfig: { mode: 'NONE' } };
  }

  if (toolChoice === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } };
  }

  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    return { 
      functionCallingConfig: { 
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.function.name]
      } 
    };
  }

  return undefined;
}

/**
 * Convert message to Gemini format
 * Note: This function should be called on individual messages, not groups of tool responses
 */
function messageToGeminiFormat(msg) {
  const role = msg.role === 'assistant' ? 'model' : 'user';

  // Handle tool call results (tool role in OpenAI format)
  if (msg.role === 'tool') {
    // Gemini expects functionResponse to have a specific format
    // The response should be the actual result data, not nested objects
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: msg.name || msg.tool_call_id || 'unknown_function',
            response: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }
        }
      ]
    };
  }

  // Handle assistant messages with tool calls
  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    const parts = [];

    // Add text content if present
    if (typeof msg.content === 'string' && msg.content.trim()) {
      parts.push({ text: msg.content });
    }

    // Add function calls
    for (const toolCall of msg.tool_calls) {
      if (toolCall.type === 'function') {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments)
          }
        });
      }
    }

    return { role: 'model', parts };
  }

  if (typeof msg.content === 'string') {
    // Simple text message
    return {
      role,
      parts: [{ text: msg.content }]
    };
  }

  if (Array.isArray(msg.content)) {
    // Multimodal message with text and/or images
    const parts = [];

    for (const content of msg.content) {
      if (content.type === 'text') {
        parts.push({ text: content.text });
      } else if (content.type === 'image_url' && content.image_url) {
        const imageUrl = content.image_url.url;

        // For simplicity, we'll just handle URL images
        // In a real implementation, you'd want to validate and possibly convert base64 images
        parts.push({
          fileData: {
            mimeType: 'image/jpeg', // Default assumption
            fileUri: imageUrl
          }
        });
      }
    }

    return { role, parts };
  }

  // Fallback for unexpected content format
  return {
    role,
    parts: [{ text: String(msg.content) }]
  };
}

/**
 * Group consecutive tool response messages into a single Gemini message
 * This addresses the Gemini API requirement that all function responses 
 * for a single function call turn must be grouped together
 */
function groupToolResponses(messages) {
  const groupedMessages = [];
  let i = 0;
  
  while (i < messages.length) {
    const currentMsg = messages[i];
    
    // If this is a tool response message, look for consecutive tool responses
    if (currentMsg.role === 'tool') {
      const toolResponseParts = [];
      
      // Collect all consecutive tool responses
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = messages[i];
        toolResponseParts.push({
          functionResponse: {
            name: toolMsg.name || toolMsg.tool_call_id || 'unknown_function',
            response: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
          }
        });
        i++;
      }
      
      // Create a single message with all tool responses
      groupedMessages.push({
        role: 'user',
        parts: toolResponseParts
      });
    } else {
      // Not a tool response, add as-is
      groupedMessages.push(currentMsg);
      i++;
    }
  }
  
  return groupedMessages;
}

/**
 * Parse SSE stream
 */
async function* parseSSEStream(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let objectBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (objectBuffer) {
        try {
          yield JSON.parse(objectBuffer);
        } catch (e) {
          console.error('Error parsing final SSE JSON object:', e);
        }
      }
      break;
    }

    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last, possibly incomplete, line.

    for (const line of lines) {
      if (line.trim() === '') {
        if (objectBuffer) {
          try {
            yield JSON.parse(objectBuffer);
          } catch (e) {
            console.error('Error parsing SSE JSON object:', e);
          }
          objectBuffer = '';
        }
      } else if (line.startsWith('data: ')) {
        objectBuffer += line.substring(6);
      }
    }
  }
}

/**
 * Perform stream request
 */
async function* performStreamRequest(
  streamRequest,
  needsThinkingClose = false,
  isRetry = false,
  realThinkingAsContent = false,
  originalModel,
  accessToken
) {
  // Show API request
  console.log('\x1b[36mSending request to Gemini API\x1b[0m');
  
  // Debug log the actual request being sent
  if (process.env.NODE_ENV !== 'production' && process.env.DEBUG_REQUESTS === 'true') {
    console.log('\x1b[33mDebug - Request body:\x1b[0m', JSON.stringify(streamRequest, null, 2));
  }
  
  // Determine which endpoint to use based on auth type
  const authType = process.env.AUTH_TYPE || AuthType.LOGIN_WITH_GOOGLE;
  let response;
  
  if (authType === AuthType.LOGIN_WITH_GOOGLE) {
    // Use the direct Gemini API endpoint for personal OAuth
    const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com';
    const GEMINI_API_VERSION = 'v1beta';
    
    response = await fetch(`${GEMINI_API_ENDPOINT}/${GEMINI_API_VERSION}/models/${streamRequest.model}:streamGenerateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        contents: streamRequest.request.contents,
        generationConfig: streamRequest.request.generationConfig,
        safetySettings: streamRequest.request.safetySettings,
        tools: streamRequest.request.tools,
        toolConfig: streamRequest.request.toolConfig
      })
    });
  } else {
    // Use the Google Cloud endpoint for other auth types
    response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(streamRequest)
    });
  }

  if (!response.ok) {
    if (response.status === 401 && !isRetry) {
      console.log('Got 401 error in stream request, clearing token cache and retrying...');
      cachedToken = null; // Clear cached token
      // In a real implementation, you'd want to refresh the token here
      throw new Error('Authentication failed');
    }

    const errorText = await response.text();
    console.error(`[GeminiAPI] Stream request failed: ${response.status}`, errorText);
    // Include the status code in the error message so the retry logic can distinguish between error types
    throw new Error(`Stream request failed: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Response has no body');
  }

  let hasClosedThinking = false;
  let hasStartedThinking = false;

  for await (const jsonData of parseSSEStream(response.body)) {
    const candidate = jsonData.response?.candidates?.[0];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        // Handle real thinking content from Gemini
        if (part.thought === true && part.text) {
          const thinkingText = part.text;

          if (realThinkingAsContent) {
            // Stream as content with <thinking> tags (DeepSeek R1 style)
            if (!hasStartedThinking) {
              yield {
                type: 'thinking_content',
                data: '<thinking>\n'
              };
              hasStartedThinking = true;
            }

            yield {
              type: 'thinking_content',
              data: thinkingText
            };
          } else {
            // Stream as separate reasoning field
            yield {
              type: 'real_thinking',
              data: thinkingText
            };
          }
        }
        // Check if text content contains <tool_call> tags
        else if (part.text && part.text.includes('<tool_call>')) {
          if (realThinkingAsContent) {
            // Extract thinking content and convert to our format
            const thinkingMatch = part.text.match(/<tool_call>(.*?)<\/think>/s);
            if (thinkingMatch) {
              if (!hasStartedThinking) {
                yield {
                  type: 'thinking_content',
                  data: '<thinking>\n'
                };
                hasStartedThinking = true;
              }

              yield {
                type: 'thinking_content',
                data: thinkingMatch[1]
              };
            }

            // Extract any non-thinking content
            const nonThinkingContent = part.text.replace(/<tool_call>.*?<\/think>/gs, '').trim();
            if (nonThinkingContent) {
              if (hasStartedThinking && !hasClosedThinking) {
                yield {
                  type: 'thinking_content',
                  data: '\n</thinking>\n\n'
                };
                hasClosedThinking = true;
              }
              yield { type: 'text', data: nonThinkingContent };
            }
          } else {
            // Stream thinking as separate reasoning field
            const thinkingMatch = part.text.match(/<tool_call>(.*?)<\/think>/s);
            if (thinkingMatch) {
              yield {
                type: 'real_thinking',
                data: thinkingMatch[1]
              };
            }

            // Stream non-thinking content as regular text
            const nonThinkingContent = part.text.replace(/<tool_call>.*?<\/think>/gs, '').trim();
            if (nonThinkingContent) {
              yield { type: 'text', data: nonThinkingContent };
            }
          }
        }
        // Handle regular content
        else if (part.text && !part.thought && !part.text.includes('<tool_call>')) {
          // Close thinking tag before first real content if needed
          if ((needsThinkingClose || (realThinkingAsContent && hasStartedThinking)) && !hasClosedThinking) {
            yield {
              type: 'thinking_content',
              data: '\n</thinking>\n\n'
            };
            hasClosedThinking = true;
          }

          yield { type: 'text', data: part.text };
        }
        // Handle function calls from Gemini
        else if (part.functionCall) {
          // Close thinking tag before function call if needed
          if ((needsThinkingClose || (realThinkingAsContent && hasStartedThinking)) && !hasClosedThinking) {
            yield {
              type: 'thinking_content',
              data: '\n</thinking>\n\n'
            };
            hasClosedThinking = true;
          }

          yield {
            type: 'tool_code',
            data: {
              name: part.functionCall.name,
              args: part.functionCall.args
            }
          };
        }
      }
    }

    if (jsonData.response?.usageMetadata) {
      const usage = jsonData.response.usageMetadata;
      yield {
        type: 'usage',
        data: {
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0
        }
      };
    }
  }
}

/**
 * Stream content with account rotation support
 */
async function* streamContent(modelId, systemPrompt, messages, options = {}) {
  // Import auth manager
  const { authManager } = require('./auth');
  
  // Get all available accounts for rotation
  let allAccounts = null;
  if (!options.accountId) {
    // Load all accounts to check if we have accounts
    allAccounts = require('./auth').loadAllAccounts();
    if (process.env.NODE_ENV !== 'development' && process.env.SHOW_DETAILED_LOGS === 'true') {
      console.log(`\x1b[36mDebug: Found ${allAccounts.size} accounts\x1b[0m`);
    }
  }
  
  // Try up to 3 different accounts before giving up
  const maxAccounts = 3;
  let lastError = null;
  
  for (let accountAttempt = 0; accountAttempt < maxAccounts; accountAttempt++) {
    // Get the next available account for rotation
    let accountId = options.accountId || 'default';
    
    // If no specific account ID is provided, use account rotation
    if (!options.accountId) {
      if (allAccounts && allAccounts.size > 0) {
        // Use account rotation (even with just one account, we still want to track usage)
        const accountInfo = await authManager.getNextAccount();
        if (accountInfo) {
          accountId = accountInfo.accountId;
          if (process.env.NODE_ENV !== 'development' && process.env.SHOW_DETAILED_LOGS === 'true') {
            if (process.env.RANDOM_ACCOUNT_SELECTION === 'true') {
              console.log(`\x1b[36mRandom account selection enabled. Selected account: ${accountId}\x1b[0m`);
            }
          }
        }
      }
    }
    
    // Try up to 3 retries with the same account before switching
    const maxRetriesPerAccount = 3;
    for (let retryAttempt = 0; retryAttempt < maxRetriesPerAccount; retryAttempt++) {
      try {
        // Get access token for the selected account
        const accessToken = await initializeAuth(accountId);
        const projectId = await discoverProjectId(accessToken);
        
        // Show which account we're using
        const requestCount = authManager.getRequestCount(accountId);
        console.log(`\x1b[36mUsing account ${accountId} (Request #${requestCount + 1} today)\x1b[0m`);

        // Show request info
        console.log('\x1b[36m%s\x1b[0m', `Chat completion request received with ${messages.length} messages`);

        // Group consecutive tool responses to satisfy Gemini API requirements
        const groupedMessages = groupToolResponses(messages);
        const contents = groupedMessages.map((msg) => messageToGeminiFormat(msg));

        if (systemPrompt) {
          contents.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
        }

        // Check if this is a thinking model
        const isThinkingModel = geminiCliModels[modelId]?.thinking || false;
        const isFakeThinkingEnabled = process.env.ENABLE_FAKE_THINKING === 'true';
        const streamThinkingAsContent = process.env.STREAM_THINKING_AS_CONTENT === 'true';
        const includeReasoning = options.includeReasoning || false;

        // For thinking models with fake thinking (fallback when real thinking is not enabled or not requested)
        let needsThinkingClose = false;
        if (isThinkingModel && isFakeThinkingEnabled && !includeReasoning) {
          yield* generateReasoningOutput(messages, streamThinkingAsContent);
          needsThinkingClose = streamThinkingAsContent; // Only need to close if we streamed as content
        }

        const generationConfig = {
          temperature: options.temperature || 0.7,
          maxOutputTokens: options.max_tokens
        };

        // Convert tools and tool_choice to Gemini format
        const geminiTools = convertToolsToGeminiFormat(options.tools);
        const geminiToolConfig = convertToolChoiceToGeminiFormat(options.tool_choice);

        // Construct stream request
        const streamRequest = {
          model: modelId,
          request: {
            contents: contents,
            generationConfig: generationConfig
          }
        };

        // Only add tools and toolConfig if they exist
        if (geminiTools) {
          streamRequest.request.tools = geminiTools;
        }
        if (geminiToolConfig) {
          streamRequest.request.toolConfig = geminiToolConfig;
        }

        // Only add project ID if it's not null (for non-personal OAuth)
        if (projectId) {
          streamRequest.project = projectId;
        }

        // Increment request count for this account
        await authManager.incrementRequestCount(accountId);

        // Yield from the stream - if this fails, it will be caught by the try/catch
        yield* performStreamRequest(
          streamRequest,
          needsThinkingClose,
          false,
          includeReasoning && streamThinkingAsContent,
          modelId,
          accessToken
        );
        
        // If we get here, the request was successful
        return;
      } catch (error) {
        // Store the error in case we need to rethrow it
        lastError = error;
        
        // If this was a specific account request, don't retry with other accounts
        if (options.accountId) {
          throw error;
        }
        
        // For 401 errors, clear the token cache and try again
        if (error.message && error.message.includes('401')) {
          console.log('Clearing token cache due to 401 error');
          // Clear token cache - this is handled by the Google Auth library now
          // Continue to retry with the same account
        }
        
        // For 403 errors (API permission issues), immediately try a different account
        if (error.message && error.message.includes('403')) {
          console.log('API permission error (403), immediately switching to different account');
          // For OAuth personal authentication, we should not switch accounts as it's a single account
          const authType = process.env.AUTH_TYPE || AuthType.LOGIN_WITH_GOOGLE;
          if (authType === AuthType.LOGIN_WITH_GOOGLE) {
            console.log('Using OAuth personal authentication, not switching accounts');
            // For personal OAuth, we should not switch accounts
            throw error;
          }
          // Break out of the retry loop to try a different account immediately
          break;
        }
        
        // Log the error (but don't expose it to the client)
        if (process.env.NODE_ENV !== 'development' && process.env.SHOW_DETAILED_LOGS === 'true') {
          console.error(`Account ${accountId} attempt ${retryAttempt + 1} failed:`, error.message);
        }
        
        // If this is the last retry attempt for this account, try a different account
        if (retryAttempt === maxRetriesPerAccount - 1) {
          console.log(`Max retries reached for account ${accountId}, switching to different account`);
          break;
        }
        
        // Otherwise, retry with the same account
        if (process.env.NODE_ENV !== 'development' && process.env.SHOW_DETAILED_LOGS === 'true') {
          console.log(`Retrying with same account ${accountId} (attempt ${retryAttempt + 2}/${maxRetriesPerAccount})`);
        }
      }
    }
  }
  
  // If we get here, all attempts failed
  throw lastError;
}

// Model information
const geminiCliModels = {
  'gemini-2.5-pro': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Pro model via OAuth (free tier)",
    thinking: true
  },
  'gemini-2.5-flash': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Flash model via OAuth (free tier)",
    thinking: true
  },
  'gemini-2.5-flash-lite': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Flash Lite model via OAuth (free tier)",
    thinking: true
  }
};

module.exports = {
  initializeAuth,
  refreshAndCacheToken,
  discoverProjectId,
  convertToolsToGeminiFormat,
  convertToolChoiceToGeminiFormat,
  messageToGeminiFormat,
  groupToolResponses,
  parseSSEStream,
  performStreamRequest,
  streamContent,
  geminiCliModels
};