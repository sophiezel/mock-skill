import { getItems, createItem } from '../service/svcA'
import { getProfile } from '../service/svcB'

export function itemsPage() {
  getItems({ page: 1 }).then((res) => {
    return res.data.list
  })
}

export function profilePage() {
  getProfile({ id: 1 }).then((res) => {
    return res.data.name
  })
}
