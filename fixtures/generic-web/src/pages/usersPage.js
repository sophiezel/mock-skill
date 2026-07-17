import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from '../api/users';

/** Consume user APIs so usage-io can infer responseShape fields. */
export function loadUsersPage() {
  return listUsers({ page: 1 }).then(({ data }) => {
    const payload = data?.data || data || {};
    const { list, total, page } = payload;
    return { list, total, page };
  });
}

export function loadUserDetail() {
  return getUser(1).then(({ data }) => {
    const payload = data?.data || data || {};
    const { id, name, email, role } = payload;
    return { id, name, email, role };
  });
}

export function submitUser(payload) {
  return createUser(payload).then(({ data }) => {
    const body = data?.data || data || {};
    const { id, name, email } = body;
    return { id, name, email };
  });
}

export function patchUser(id, payload) {
  return updateUser(id, payload).then(({ data }) => {
    const body = data?.data || data || {};
    const { id: userId, name, email, updatedAt } = body;
    return { userId, name, email, updatedAt };
  });
}

export function removeUser(id) {
  return deleteUser(id).then(({ data }) => {
    const body = data?.data || data || {};
    const { success, deletedId } = body;
    return { success, deletedId };
  });
}
