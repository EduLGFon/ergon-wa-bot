/**
 * Shared type definitions for the sticker engine.
 * Used by both the main thread and worker threads.
 */

/** Supported sticker crop/resize formats */
export type StickerFormat = 'full' | 'crop' | 'circle' | 'rounded'

/** Metadata embedded into the sticker's EXIF data */
export interface StickerMetadata {
	pack: string
	author: string
}

/** A single sticker output (format + WebP buffer) */
export interface StickerResult {
	format: StickerFormat
	buffer: Buffer
}

/** Options for the public createStickers() API */
export interface StickerOptions {
	/** Raw media buffer (image, video, or GIF) */
	buffer: Buffer
	/** Whether the input is a video/GIF (true) or image (false) */
	isVideo: boolean
	/** Which sticker formats to generate */
	formats: StickerFormat[]
	/** Sticker pack metadata for EXIF injection */
	metadata: StickerMetadata
	/** Image quality override (1–100). Only affects images. */
	quality?: number
	/** Maximum sticker file size in bytes (default: 1 MB) */
	maxSize?: number
}

// ── Worker thread protocol ──────────────────────────────────────────

/** Message sent from the main thread to a sticker worker */
export interface WorkerRequest {
	id: number
	buffer: Buffer
	formats: StickerFormat[]
	maxSize: number
}

/** Message sent from a sticker worker back to the main thread */
export interface WorkerResponse {
	id: number
	results?: { format: StickerFormat; buffer: Buffer }[]
	error?: string
}
