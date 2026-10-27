export const fixtureNames = [
  'small-theater',
  'opera-hall',
  'arena',
  'banquet-hall',
] as const;

export {
  createPerformanceHallSnapshot,
  PERFORMANCE_HALL_ID,
  PERFORMANCE_HALL_NAME,
  PERFORMANCE_HALL_SEAT_COUNT,
} from './performanceHall.js';
