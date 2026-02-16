'use client';

import { useState } from 'react';
import { CreateTaskForm } from '@/components/CreateTaskForm';

interface Product {
  id: string;
  name: string;
  status: string;
}

export function NewTaskSection({ products }: { products: Product[] }) {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return <CreateTaskForm products={products} onClose={() => setShowForm(false)} />;
  }

  return (
    <button
      onClick={() => setShowForm(true)}
      className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
    >
      + New Task
    </button>
  );
}
