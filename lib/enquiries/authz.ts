/**
 * Owner access is membership in public.owners, keyed by the verified user id
 * (`sub` from getClaims). user_metadata is not an authorization source.
 */
export function canReviewEnquiries(input: {
  userId: string | null;
  ownerIds: readonly string[];
}): boolean {
  if (!input.userId) return false;
  return input.ownerIds.includes(input.userId);
}
