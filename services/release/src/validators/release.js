import { z } from 'zod';

export const createReleaseSchema = z.object({
  name: z.string().min(1).max(255),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  owner_id: z.string().uuid(),
  jira_version_id: z.string().optional(),
});

export const updateReleaseSchema = z.object({
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'scheduled', 'deployed', 'cancelled']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const listReleasesSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
