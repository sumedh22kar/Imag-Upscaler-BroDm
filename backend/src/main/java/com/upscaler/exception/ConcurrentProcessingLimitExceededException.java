package com.upscaler.exception;

/**
 * Thrown when image processing concurrency capacity is exhausted.
 */
public class ConcurrentProcessingLimitExceededException extends RuntimeException {

    public ConcurrentProcessingLimitExceededException(String message) {
        super(message);
    }

    public ConcurrentProcessingLimitExceededException(String message, Throwable cause) {
        super(message, cause);
    }
}
