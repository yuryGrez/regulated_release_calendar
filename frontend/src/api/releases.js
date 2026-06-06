import client from './client.js';

export const releasesApi = {
  /** List releases, optionally filtered by date range */
  list: (from, to) => {
    const params = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    return client.get('/api/v1/releases', { params }).then((r) => r.data);
  },

  /** Get single release with risk detail */
  get: (id) => client.get(`/api/v1/releases/${id}`).then((r) => r.data),

  /** Create a new release */
  create: (body) => client.post('/api/v1/releases', body).then((r) => r.data),

  /** Update a release (planned_date / status) */
  update: (id, body) => client.patch(`/api/v1/releases/${id}`, body).then((r) => r.data),

  /** Soft-delete a release */
  remove: (id) => client.delete(`/api/v1/releases/${id}`),

  /** Poll the risk score for a release */
  getRisk: (id) => client.get(`/api/v1/releases/${id}/risk`).then((r) => r.data),
};
