import { listTags } from '../api/tags';

/**
 * Custom declarative list using NON-standard prop names (rows / fields / key).
 * The project registers a `datalist-key` plugin in infer.json. Fields
 * id / label should be inferred from fields[].key even though no built-in
 * pattern (dataSource/columns/dataIndex) matches here.
 */
export function loadTagsList() {
  return listTags({ page: 1 }).then(({ data }) => {
    const payload = data?.data || data || [];
    const fields = [
      { title: 'ID', key: 'id' },
      { title: 'Label', key: 'label' },
      { title: 'Op', key: 'action' },
    ];
    return (
      <DataList
        rows={payload}
        fields={fields}
      />
    );
  });
}
