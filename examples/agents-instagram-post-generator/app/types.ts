export interface Image {
	/**
	 * The base64-encoded JSON of the generated image, if `response_format` is
	 * `b64_json`.
	 */
	b64_json?: string;

	/**
	 * The prompt that was used to generate the image, if there was any revision to the
	 * prompt.
	 */
	revised_prompt?: string;

	/**
	 * The URL of the generated image, if `response_format` is `url` (default).
	 */
	url?: string;
}

export type ImageModel = 'dall-e-2' | 'dall-e-3';

export interface ImagesResponse {
	created: number;

	data: Array<Image>;
}