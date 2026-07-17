import { request as http } from '@umijs/max';

/** import alias still resolves via importSources */
export async function listTasks() {
  return http('/cars-task/external/evaluate/task/list', {
    method: 'GET',
  });
}

/** config CallShape */
export async function getTaskById(id: string) {
  return http({
    url: '/cars-task/external/evaluate/task/detail',
    method: 'GET',
    params: { id },
  });
}
