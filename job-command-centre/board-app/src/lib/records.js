// Pull the named field out of a record, whether the SDK returns it flat or nested
// under a `data` envelope.
export function field(r, k) {
  return r && r.data && r.data[k] != null ? r.data[k] : r ? r[k] : undefined;
}
