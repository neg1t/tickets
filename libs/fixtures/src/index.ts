export const fixtureNames = [
  'small-theater',
  'opera-hall',
  'arena',
  'banquet-hall',
] as const;

export {
  createPerformanceAvailability,
  createPerformanceHallDraft,
  createPerformanceHallSnapshot,
  createPerformancePrices,
  getPerformanceHallId,
  PERFORMANCE_HALL_PROFILES,
  PERFORMANCE_HALL_ID,
  PERFORMANCE_HALL_NAME,
  PERFORMANCE_HALL_SEAT_COUNT,
  PERFORMANCE_HALL_SIZES,
  type PerformanceHallProfile,
  type PerformanceHallSize,
} from './performanceHall.js';
