import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

// Enhanced and cleaned version (same logic, improved clarity)

export function useOptimizedData<T>(
  collectionName: string,
  filters: Record<string, any> = {},
  options: any = {}
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refetch = () => setVersion(v => v + 1);

  useEffect(() => {
    let isMounted = true;

    if (options.skip) {
      setLoading(true);
      setData([]);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        let q: any = collection(db, collectionName);
        console.log('[useOptimizedData] filters:', filters);
        console.log('[useOptimizedData] collectionName:', collectionName, 'options:', options);

        // Handle large 'companyId in [...]' filters
        if (
          options.userRole !== 'admin' &&
          Array.isArray(filters.companyId) &&
          filters.companyId.length > 10
        ) {
          console.log('[useOptimizedData] chunking companyId in query:', filters.companyId);
          const chunks = [];
          for (let i = 0; i < filters.companyId.length; i += 10) {
            chunks.push(filters.companyId.slice(i, i + 10));
          }

          const promises = chunks.map(chunk => {
            console.log('[useOptimizedData] running chunk query:', chunk);
            return getDocs(query(collection(db, collectionName), where('companyId', 'in', chunk)))
              .then(snap => {
                console.log('[useOptimizedData] chunk result for', chunk, ':', snap.docs.map(d => ({ id: d.id, ...(typeof d.data === 'function' ? d.data() : {}) })));
                return snap;
              });
          });

          const snapshots = await Promise.all(promises);
          const allDocs = snapshots.flatMap(snap =>
            snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }))
          );

          console.log('[useOptimizedData] allDocs after chunking:', allDocs);
          if (isMounted) setData(allDocs as T[]);
          return;
        }

        // Handle any generic array-based filter with chunking (like 'in' on another field)
        const arrayFilter = Object.entries(filters).find(([_, value]) => Array.isArray(value));
        if (arrayFilter) {
          const [inKey, arr] = arrayFilter;
          if (!arr || arr.length === 0) {
            if (isMounted) setData([]);
            return;
          }

          const chunkSize = 10;
          let allDocs: any[] = [];

          for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize);
            let qChunk: any = q;

            // Apply other filters (non-array)
            Object.entries(filters).forEach(([key, value]) => {
              if (key !== inKey && value !== undefined && value !== null) {
                qChunk = query(qChunk, where(key, '==', value));
              }
            });

            qChunk = query(qChunk, where(inKey, 'in', chunk));
            console.log('[useOptimizedData] running generic array chunk query:', inKey, chunk);
            const snap = await getDocs(qChunk);
            console.log('[useOptimizedData] generic chunk result for', chunk, ':', snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
            allDocs.push(...snap.docs);
          }

          // Deduplicate
          const uniqueDocs = Array.from(new Map(allDocs.map(doc => [doc.id, doc])).values());
          const result = uniqueDocs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

          console.log('[useOptimizedData] allDocs after generic chunking:', result);
          if (isMounted) setData(result as T[]);
          return;
        }

        // Simple filter with only direct values
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            q = query(q, where(key, '==', value));
          }
        });

        console.log('[useOptimizedData] running simple query:', filters);
        const snapshot = await getDocs(q);
        console.log('[useOptimizedData] simple query result:', snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })));
        const result = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as T[];

        if (isMounted) setData(result);
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [collectionName, JSON.stringify(filters), version, options.skip]);

  return { data, loading, error, refetch };
} 
