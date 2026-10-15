// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The alignment surface: clitic segments of the written word and vowel marks
// placed on it. Both package-root entries re-export it. The modules under
// src/align/ import only engine modules, and the engine imports nothing from
// here. New design: project header only.
export {
  cliticSegments,
  type CliticRole,
  type CliticSegment,
  type CliticSegmentsOptions,
} from './clitic-segments.js';
export { placeMarks, agreedMarks } from './vowel-marks.js';
