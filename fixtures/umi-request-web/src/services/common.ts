import { request } from '@umijs/max';

/** direct CallShape: request(url, { method }) */
export async function getCurrentUser() {
  return request('/eva-schedule/external/common/currentUser/info', {
    method: 'GET',
  });
}

export async function getPanelList(params: Record<string, unknown>) {
  return request('/external/panel/list/v2', {
    method: 'GET',
    params,
  });
}

export async function createPanel(body: Record<string, unknown>) {
  return request('/external/panel/create', {
    method: 'POST',
    data: body,
  });
}

export async function getPermissions() {
  return request('/permission/api/spc/user/permissions', {
    method: 'GET',
  });
}
