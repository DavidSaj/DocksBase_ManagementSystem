import { useState, useCallback } from 'react';
import api from '../api.js';

export default function useBoaterAccounts() {
  const [accounts, setAccounts]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [selectedId, setSelectedId]       = useState(null);
  const [drawerData, setDrawerData]       = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const fetchAccounts = useCallback(async ({ search = '', showAll = false } = {}) => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (showAll) params.show_all = 'true';
    try {
      const r = await api.get('/billing/accounts/', { params });
      setAccounts(r.data.results ?? r.data);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openDrawer = useCallback(async (memberId) => {
    setSelectedId(memberId);
    setDrawerLoading(true);
    try {
      const r = await api.get(`/billing/accounts/${memberId}/`);
      setDrawerData(r.data);
    } catch {
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const refreshDrawer = useCallback(async (memberId) => {
    if (!memberId) return;
    setDrawerLoading(true);
    try {
      const r = await api.get(`/billing/accounts/${memberId}/`);
      setDrawerData(r.data);
    } catch {
      // keep existing data on refetch failure
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedId(null);
    setDrawerData(null);
  }, []);

  return {
    accounts, loading, fetchAccounts,
    selectedId, drawerData, drawerLoading,
    openDrawer, refreshDrawer, closeDrawer,
  };
}
