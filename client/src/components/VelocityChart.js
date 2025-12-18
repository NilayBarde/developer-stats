import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import ChartCard from './ChartCard';

function VelocityChart({ sprints }) {
  const data = sprints.map((sprint, index) => ({
    name: `Sprint ${sprints.length - index}`,
    points: sprint.points,
    issues: sprint.issues,
    date: format(new Date(sprint.endDate), 'MMM dd')
  }));

  return (
    <ChartCard title="Velocity Over Time">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="points"
            stroke="#667eea"
            strokeWidth={2}
            name="Story Points"
          />
          <Line
            type="monotone"
            dataKey="issues"
            stroke="#764ba2"
            strokeWidth={2}
            name="Issues"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default VelocityChart;

