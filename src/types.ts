/**
 * Ciwei AI
 */
export interface CiweiAIResolvedAccount {
    accountId: string;
    config: {
        token?: string;
    };
    enabled: boolean;
    configured: boolean;
}

/**
 * Inbound
 */
export interface RelayInboundMessage {
	type?: string;
	from: string;
	userId?: string;
	text: string;
	chatId: string;
	id: string;
}

/**
 * Outbound
 */
export interface RelayReplyMessage {
    type: "reply";
    to: string;
    chatId: string;
    text: string;
    replyTo: string;
    isPartial?: boolean;
    isFinal?: boolean;
}
