import { describe, expect, it } from "vitest";
import {
  cancelUpload,
  endUpload,
  PROGRESS_DELAY_MS,
  PROGRESS_SIZE_BYTES,
  reportUpload,
  showsUploadProgress,
  startUpload,
  uploadFraction,
  uploadProgressDueIn,
  uploadState,
} from "./upload-progress";

const MB = 1024 * 1024;

describe("when an upload shows its ring", () => {
  it("shows a file over 7 MB from its first byte", () => {
    expect(showsUploadProgress({ size: 8 * MB, startedAt: 1000 }, 1000)).toBe(true);
    expect(uploadProgressDueIn({ size: 8 * MB, startedAt: 1000 }, 1000)).toBeNull();
  });

  it("keeps a 7 MB file and anything smaller quiet for the first two seconds", () => {
    expect(showsUploadProgress({ size: PROGRESS_SIZE_BYTES, startedAt: 1000 }, 1000)).toBe(false);
    expect(showsUploadProgress({ size: 200 * 1024, startedAt: 1000 }, 1000 + PROGRESS_DELAY_MS - 1)).toBe(false);
    expect(uploadProgressDueIn({ size: 200 * 1024, startedAt: 1000 }, 1500)).toBe(PROGRESS_DELAY_MS - 500);
  });

  it("shows a small upload still going after two seconds", () => {
    expect(showsUploadProgress({ size: 200 * 1024, startedAt: 1000 }, 1000 + PROGRESS_DELAY_MS)).toBe(true);
    expect(uploadProgressDueIn({ size: 200 * 1024, startedAt: 1000 }, 1000 + PROGRESS_DELAY_MS)).toBeNull();
  });
});

describe("upload fraction", () => {
  it("is unknown until the path reports a total", () => {
    expect(uploadFraction({ loaded: 0, total: null })).toBeNull();
    expect(uploadFraction({ loaded: 10, total: 0 })).toBeNull();
  });

  it("follows the bytes sent and holds below 100% until the server answers", () => {
    expect(uploadFraction({ loaded: 0, total: 100 })).toBe(0);
    expect(uploadFraction({ loaded: 77, total: 100 })).toBe(0.77);
    expect(uploadFraction({ loaded: 100, total: 100 })).toBe(0.99);
    expect(uploadFraction({ loaded: 140, total: 100 })).toBe(0.99);
  });
});

describe("upload progress store", () => {
  it("records reports for a started upload and forgets it when it ends", () => {
    startUpload("tile-a", 9 * MB, 5000);
    expect(uploadState("tile-a")).toEqual({ size: 9 * MB, startedAt: 5000, loaded: 0, total: null });
    reportUpload("tile-a", 3 * MB, 9 * MB);
    expect(uploadState("tile-a")).toMatchObject({ loaded: 3 * MB, total: 9 * MB });
    endUpload("tile-a");
    expect(uploadState("tile-a")).toBeUndefined();
    reportUpload("tile-a", 4 * MB, 9 * MB);
    expect(uploadState("tile-a")).toBeUndefined();
  });

  it("aborts a cancelled upload's request", () => {
    const signal = startUpload("tile-b", 1024);
    cancelUpload("tile-b");
    expect(signal.aborted).toBe(true);
    expect(uploadState("tile-b")).toBeUndefined();
  });
});
