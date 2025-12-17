/**
 * Helper functions to distinguish between missing data and empty data
 * Missing data (undefined/null) = we don't know if data exists = show dash (-)
 * Empty data (empty array/false) = data confirmed to be empty = show appropriate message
 */

/**
 * Check if data is missing (undefined or null)
 */
export const isMissing = (value: any): boolean => {
  return value === undefined || value === null;
};

/**
 * Check if data is empty but not missing
 */
export const isEmpty = (value: any): boolean => {
  if (isMissing(value)) return false;

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  return false;
};

/**
 * Get display text for a section based on whether data is missing or empty
 * @param data - The data to check
 * @param emptyMessage - Message to show when data is empty but not missing
 * @param missingIndicator - Indicator to show when data is missing (default: "-")
 */
export const getEmptyStateText = (
  data: any,
  emptyMessage: string,
  missingIndicator: string = '-'
): string => {
  if (isMissing(data)) {
    return missingIndicator;
  }

  if (isEmpty(data)) {
    return emptyMessage;
  }

  return '';
};

/**
 * Check if data should show content (not missing and not empty)
 */
export const hasContent = (value: any): boolean => {
  return !isMissing(value) && !isEmpty(value);
};
