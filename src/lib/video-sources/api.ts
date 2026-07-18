import { NextResponse } from "next/server";
import { AgedmInspectionError } from "./providers/agedm";
import { VideoSourceImportValidationError } from "./imports";
import { VideoSourceNetworkError } from "./network-safety";
import {
  UnsupportedVideoSourceError,
  VideoSourcePlanStaleError,
} from "./registry";

export function videoSourceErrorResponse(error: unknown) {
  if (error instanceof UnsupportedVideoSourceError) {
    return NextResponse.json(
      { error: "UNSUPPORTED_VIDEO_SOURCE", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof VideoSourceImportValidationError) {
    return NextResponse.json(
      { error: "VIDEO_SOURCE_VALIDATION_ERROR", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof VideoSourcePlanStaleError) {
    return NextResponse.json(
      { error: "VIDEO_SOURCE_PLAN_STALE", message: error.message },
      { status: 409 },
    );
  }
  if (error instanceof AgedmInspectionError) {
    return NextResponse.json(
      { error: "VIDEO_SOURCE_PARSE_ERROR", message: error.message },
      { status: 422 },
    );
  }
  if (error instanceof VideoSourceNetworkError) {
    return NextResponse.json(
      { error: "VIDEO_SOURCE_NETWORK_ERROR", message: error.message },
      { status: 502 },
    );
  }
  return null;
}
