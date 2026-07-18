import { listItems } from '../api/items';

/**
 * Generic declarative grid (no UI-library import). Proves the
 * DeclarativeFieldSource plugin matches by prop NAME (dataSource +
 * columns[].dataIndex), not by component library symbol. Fields
 * id / name / price should be inferred from columns[].dataIndex even
 * though no Table/component-library import exists.
 */
export function loadItemsGrid() {
  return listItems({ page: 1 }).then(({ data }) => {
    const payload = data?.data || data || [];
    const columns = [
      { title: 'ID', dataIndex: 'id' },
      { title: 'Name', dataIndex: 'name' },
      { title: 'Price', dataIndex: 'price' },
      { title: 'Op', dataIndex: 'action' },
    ];
    return (
      <DataGrid
        dataSource={payload}
        columns={columns}
      />
    );
  });
}
