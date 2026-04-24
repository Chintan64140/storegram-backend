const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const getPaginationParams = (
  query,
  { defaultLimit = 10, maxLimit = 100, prefix = '' } = {},
) => {
  const pageKey = prefix ? `${prefix}Page` : 'page';
  const limitKey = prefix ? `${prefix}Limit` : 'limit';

  const parsedPage = Number.parseInt(query?.[pageKey], 10);
  const parsedLimit = Number.parseInt(query?.[limitKey], 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = clamp(
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit,
    1,
    maxLimit,
  );

  return {
    page,
    limit,
    from: (page - 1) * limit,
    to: page * limit - 1,
  };
};

export const createPaginationMeta = ({ page, limit, totalItems }) => {
  const normalizedTotalItems = Number(totalItems || 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotalItems / limit));

  return {
    page,
    limit,
    totalItems: normalizedTotalItems,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
  };
};

