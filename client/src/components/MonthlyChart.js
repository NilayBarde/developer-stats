import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { format, parseISO } from 'date-fns';
import ChartCard from './ChartCard';

function MonthlyChart({ monthlyData, title, dataKey = 'count' }) {
  if (!monthlyData || monthlyData.length === 0) {
    return null;
  }

  const chartData = monthlyData.map(item => ({
    month: format(parseISO(`${item.month}-01`), 'MMM yyyy'),
    count: item.count || 0
  }));

  // Don't filter out months - show all months in range even if count is 0
  // This allows users to see the full timeline

  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="month" 
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey={dataKey} fill="#667eea" name="Count" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default MonthlyChart;

