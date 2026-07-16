import axios from 'axios';

export function listUsers(params) {
  return axios.get('https://api.example.com/v1/users', { params });
}

export function getUser(id) {
  return axios.get('https://api.example.com/v1/users/1');
}

export function createUser(payload) {
  return axios.post('https://api.example.com/v1/users', payload);
}

export function updateUser(id, payload) {
  return axios.put('https://api.example.com/v1/users/1', payload);
}

export function deleteUser(id) {
  return axios.delete('https://api.example.com/v1/users/1');
}
