import type { AiAssistantSDK } from '@n8n_io/ai-assistant-sdk';
import type { Response } from 'express';
import { strict as assert } from 'node:assert';
import { WritableStream } from 'node:stream/web';

import { FREE_AI_CREDITS_CREDENTIAL_NAME, OPEN_AI_API_CREDENTIAL_TYPE } from '@/constants';
import { CredentialsService } from '@/credentials/credentials.service';
import { Post, RestController } from '@/decorators';
import { InternalServerError } from '@/errors/response-errors/internal-server.error';
import type { CredentialRequest } from '@/requests';
import { AiAssistantRequest } from '@/requests';
import { AiService } from '@/services/ai.service';
import { UserService } from '@/services/user.service';

type FlushableResponse = Response & { flush: () => void };

@RestController('/ai')
export class AiController {
	constructor(
		private readonly aiService: AiService,
		private readonly credentialsService: CredentialsService,
		private readonly userService: UserService,
	) {}

	@Post('/chat', { rateLimit: { limit: 100 } })
	async chat(req: AiAssistantRequest.Chat, res: FlushableResponse) {
		try {
			const aiResponse = await this.aiService.chat(req.body, req.user);
			if (aiResponse.body) {
				res.header('Content-type', 'application/json-lines').flush();
				await aiResponse.body.pipeTo(
					new WritableStream({
						write(chunk) {
							res.write(chunk);
							res.flush();
						},
					}),
				);
				res.end();
			}
		} catch (e) {
			assert(e instanceof Error);
			throw new InternalServerError(e.message, e);
		}
	}

	@Post('/chat/apply-suggestion')
	async applySuggestion(
		req: AiAssistantRequest.ApplySuggestionPayload,
	): Promise<AiAssistantSDK.ApplySuggestionResponse> {
		try {
			return await this.aiService.applySuggestion(req.body, req.user);
		} catch (e) {
			assert(e instanceof Error);
			throw new InternalServerError(e.message, e);
		}
	}

	@Post('/ask-ai')
	async askAi(req: AiAssistantRequest.AskAiPayload): Promise<AiAssistantSDK.AskAiResponsePayload> {
		try {
			return await this.aiService.askAi(req.body, req.user);
		} catch (e) {
			assert(e instanceof Error);
			throw new InternalServerError(e.message, e);
		}
	}

	@Post('/free-credits')
	async aiCredits(req: AiAssistantRequest.FreeAiCreditsPayload) {
		try {
			const aiCredits = await this.aiService.createFreeAiCredits(req.user);

			const credentialProperties: CredentialRequest.CredentialProperties = {
				name: FREE_AI_CREDITS_CREDENTIAL_NAME,
				type: OPEN_AI_API_CREDENTIAL_TYPE,
				data: {
					apiKey: aiCredits.apiKey,
					url: aiCredits.url,
				},
				isManaged: true,
			};

			const newCredential = await this.credentialsService.createCredential(
				credentialProperties,
				req.user,
			);

			await this.userService.updateSettings(req.user.id, {
				userClaimedAiCredits: true,
			});

			return newCredential;
		} catch (e) {
			assert(e instanceof Error);
			throw new InternalServerError(e.message, e);
		}
	}
}
