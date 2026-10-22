import { useState } from 'react'
import { api } from '../lib/api'

// Cheque archive, read only (owner, 2026-10-21, D-060): the records kept from before cheques were
// removed. Nothing here creates, settles or deletes a cheque.
export function useChecksManager() {
  const [checksList, setChecksList] = useState([])

  const fetchChecksList = async () => {
    try {
      const res = await api('checks.archive')
      setChecksList(res.rows || [])
    } catch (err) {
      console.error('fetchChecksList error:', err)
    }
  }

  return { checksList, fetchChecksList }
}
