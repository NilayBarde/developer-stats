import React, { useState, useRef, useEffect } from 'react';
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
import { format } from 'date-fns';
import ChartCard from './ChartCard';
import { extractSprintNum } from '../utils/velocityHelpers';
import './VelocityChart.css';

// Velocity benchmarks
const VELOCITY_BENCHMARKS = {
  P2_AVERAGE: 5.9,
  TEAM_AVERAGE: 6.0
};

function VelocityChart({ sprints, title = "Velocity Over Time", showBenchmarks = false, baseUrl }) {
  const [tooltipData, setTooltipData] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const tooltipRef = useRef(null);
  const hideTimeoutRef = useRef(null);

  // Sprints are already sorted oldest to newest (left to right)
  const data = sprints.map((sprint, index) => {
    const startDate = sprint.startDate ? format(new Date(sprint.startDate), 'MMM dd') : '';
    const endDate = sprint.endDate ? format(new Date(sprint.endDate), 'MMM dd') : '';
    const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : (endDate || startDate || '');
    const sprintNum = extractSprintNum(sprint.name);
    // Use very compact format: Sprint number + start date only
    const sprintLabel = sprintNum 
      ? `S${sprintNum} ${startDate || ''}`
      : (startDate || `S${index + 1}`);
    
    const dataPoint = {
      name: sprintLabel,
      points: sprint.points,
      date: dateRange,
      fullName: sprint.name || `Sprint ${index + 1}`,
      sprintName: sprint.name,
      issueKeys: sprint.issueKeys || [],
      baseUrl: baseUrl
    };
    
    // Only add benchmarks if showBenchmarks is true
    if (showBenchmarks) {
      dataPoint.teamAvg = VELOCITY_BENCHMARKS.TEAM_AVERAGE;
      dataPoint.p2Avg = VELOCITY_BENCHMARKS.P2_AVERAGE;
    }
    
    return dataPoint;
  });

  const CustomTooltip = ({ active, payload, coordinate }) => {
    useEffect(() => {
      if (active && payload && payload.length) {
        const data = payload[0].payload;
        setTooltipData(data);
        if (coordinate) {
          setTooltipPosition({ x: coordinate.x, y: coordinate.y });
        }
        setIsTooltipVisible(true);
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
      } else {
        // Delay hiding to allow moving mouse to tooltip
        hideTimeoutRef.current = setTimeout(() => {
          if (!tooltipRef.current?.matches(':hover')) {
            setIsTooltipVisible(false);
          }
        }, 100);
      }
    }, [active, payload, coordinate]);

    return null;
  };

  useEffect(() => {
    // Capture ref value at the start of the effect
    const currentRef = tooltipRef.current;
    
    const handleMouseMove = (e) => {
      if (currentRef && currentRef.contains(e.target)) {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
        setIsTooltipVisible(true);
      }
    };

    const handleMouseLeave = () => {
      hideTimeoutRef.current = setTimeout(() => {
        setIsTooltipVisible(false);
      }, 300);
    };

    if (isTooltipVisible && currentRef) {
      currentRef.addEventListener('mouseleave', handleMouseLeave);
      document.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      // Use the captured ref value from the start of the effect
      if (currentRef) {
        currentRef.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isTooltipVisible]);

  return (
    <ChartCard title={title}>
      <div className="velocity-chart-container">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart 
            data={data}
            margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              angle={-45}
              textAnchor="end"
              height={70}
              interval={0}
              tick={{ fontSize: 11 }}
            />
            <YAxis />
            <Tooltip 
              content={<CustomTooltip />}
              isAnimationActive={false}
            />
            <Bar
              dataKey="points"
              fill="#667eea"
              name="Story Points"
            />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
        
        {/* Custom persistent tooltip */}
        {isTooltipVisible && tooltipData && (
          <div
            ref={tooltipRef}
            className="velocity-tooltip"
            style={{
              left: `${tooltipPosition.x}px`,
              top: `${tooltipPosition.y - 10}px`,
              transform: 'translate(-50%, -100%)'
            }}
            onMouseEnter={() => {
              if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
              }
              setIsTooltipVisible(true);
            }}
            onMouseLeave={() => {
              hideTimeoutRef.current = setTimeout(() => {
                setIsTooltipVisible(false);
              }, 200);
            }}
          >
            <p className="velocity-tooltip-title">
              {tooltipData.fullName || tooltipData.name}
            </p>
            <p className="velocity-tooltip-points">
              Story Points: <strong>{tooltipData.points}</strong>
            </p>
            {tooltipData.date && (
              <p className="velocity-tooltip-date">
                {tooltipData.date}
              </p>
            )}
            {tooltipData.issueKeys && tooltipData.issueKeys.length > 0 && (
              <div className="velocity-tooltip-tickets">
                <strong>Tickets ({tooltipData.issueKeys.length}):</strong>
                <div className="velocity-tooltip-tickets-list">
                  {tooltipData.issueKeys.map((key, idx) => (
                    <div key={idx} className="velocity-tooltip-ticket-item">
                      <a 
                        href={`${tooltipData.baseUrl || baseUrl || 'https://jira.disney.com'}/browse/${key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="velocity-tooltip-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`${tooltipData.baseUrl || baseUrl || 'https://jira.disney.com'}/browse/${key}`, '_blank');
                        }}
                      >
                        {key}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export default VelocityChart;
