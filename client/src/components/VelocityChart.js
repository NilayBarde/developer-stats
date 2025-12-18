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

// Velocity benchmarks
const VELOCITY_BENCHMARKS = {
  P2_AVERAGE: 5.9,
  TEAM_AVERAGE: 6.0
};

function VelocityChart({ sprints, title = "Velocity Over Time", showBenchmarks = false }) {
  // Extract sprint number from sprint name (e.g., "Sprint 48" -> "48", "P2 Sprint 48" -> "48")
  const extractSprintNumber = (sprintName) => {
    if (!sprintName) return '';
    const match = sprintName.match(/(\d+)/);
    return match ? match[1] : sprintName;
  };

  // Sprints are already sorted oldest to newest (left to right)
  const data = sprints.map((sprint, index) => {
    const startDate = sprint.startDate ? format(new Date(sprint.startDate), 'MMM dd') : '';
    const endDate = sprint.endDate ? format(new Date(sprint.endDate), 'MMM dd') : '';
    const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : (endDate || startDate || '');
    const sprintNumber = extractSprintNumber(sprint.name) || (index + 1).toString();
    
    const dataPoint = {
      name: `Sprint ${sprintNumber}`,
      points: sprint.points,
      date: dateRange,
      fullName: `Sprint ${sprintNumber} (${dateRange})`
    };
    
    // Only add benchmarks if showBenchmarks is true
    if (showBenchmarks) {
      dataPoint.teamAvg = VELOCITY_BENCHMARKS.TEAM_AVERAGE;
      dataPoint.p2Avg = VELOCITY_BENCHMARKS.P2_AVERAGE;
    }
    
    return dataPoint;
  });

  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="name" 
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis />
          <Tooltip 
            formatter={(value, name) => {
              if (name === 'FTE Avg' || name === 'P2 Avg') {
                return [value, name];
              }
              return [value, 'Story Points'];
            }}
            labelFormatter={(label, payload) => {
              if (payload && payload[0]) {
                return payload[0].payload.fullName || label;
              }
              return label;
            }}
          />
          {/* Benchmark lines - only shown if showBenchmarks is true */}
          {showBenchmarks && (
            <>
              <Line
                type="monotone"
                dataKey="teamAvg"
                stroke="#48bb78"
                strokeDasharray="5 5"
                strokeWidth={2}
                name={`FTE Avg: ${VELOCITY_BENCHMARKS.TEAM_AVERAGE}`}
                dot={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="p2Avg"
                stroke="#ed8936"
                strokeDasharray="5 5"
                strokeWidth={2}
                name={`P2 Avg: ${VELOCITY_BENCHMARKS.P2_AVERAGE}`}
                dot={false}
                activeDot={false}
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="points"
            stroke="#667eea"
            strokeWidth={2}
            name="Story Points"
          />
          <Legend />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default VelocityChart;

