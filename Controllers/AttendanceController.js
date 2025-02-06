const Attendance = require('../Models/Attendance');
const Employee = require('../Models/Employee');
const moment = require('moment-timezone');



exports.getLoggedInEmployeeAttendance = async(req, res) => {
    const currentTime = moment().tz('Asia/Karachi');
    let shiftStartTime = currentTime.clone().hour(17).minute(0).second(0);
    let shiftEndTime = shiftStartTime.clone().add(15, 'hours');

    if (currentTime.isBefore(shiftStartTime)) {
        shiftStartTime.subtract(1, 'day');
        shiftEndTime.subtract(1, 'day');
    }

    try {
        const attendanceRecords = await Attendance.aggregate([{
                $addFields: {
                    fullLoginTime: {
                        $dateFromString: {
                            dateString: { $concat: [{ $dateToString: { format: '%Y-%m-%d', date: '$date' } }, ' ', '$in_time'] },
                            timezone: 'Asia/Karachi',
                        },
                    },
                    fullLogoutTime: {
                        $dateFromString: {
                            dateString: { $concat: [{ $dateToString: { format: '%Y-%m-%d', date: '$date' } }, ' ', '$out_time'] },
                            timezone: 'Asia/Karachi',
                        },
                    },
                },
            },
            {
                $match: {
                    $or: [
                        { fullLoginTime: { $gte: shiftStartTime.toDate(), $lt: shiftEndTime.toDate() } },
                        { fullLogoutTime: { $gte: shiftStartTime.toDate(), $lt: shiftEndTime.toDate() } },
                    ],
                },
            },
            { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'employeeDetails' } },
            { $unwind: { path: '$employeeDetails', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'designations', localField: 'employeeDetails.designation', foreignField: '_id', as: 'designationDetails' } },
            { $unwind: { path: '$designationDetails', preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    'employeeDetails.role': '$designationDetails.role',
                    formattedLoginTime: {
                        $cond: {
                            if: { $not: ['$in_time'] },
                            then: 'Not Logged In',
                            else: { $dateToString: { format: '%H:%M:%S', date: '$fullLoginTime' } },
                        },
                    },
                    formattedLogoutTime: {
                        $cond: {
                            if: { $not: ['$out_time'] },
                            then: { $cond: { if: { $eq: ['$is_logged_in', true] }, then: 'Not Logged Out Yet', else: 'Not Logged Out Yet' } },
                            else: { $dateToString: { format: '%H:%M:%S', date: '$fullLogoutTime' } },
                        },
                    },
                },
            },
        ]);

        const allEmployees = await Employee.find();
        const totalEmployeeCount = allEmployees.length;
        let loggedInEmployees = [];
        let leaveEmployees = [];

        attendanceRecords.forEach((record) => {
            const { employeeDetails, in_time, out_time, is_logged_in, date } = record;
            console.log(in_time, out_time)
            const employeeScheduledTime = employeeDetails ? .in_time;
            const formattedLoginTime = in_time ?
                moment(`${moment(date).format('YYYY-MM-DD')} ${in_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Karachi').format('HH:mm:ss') :
                'Not Logged In';
            const formattedLogoutTime = out_time ?
                moment(`${moment(date).format('YYYY-MM-DD')} ${out_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Karachi').format('HH:mm:ss') :
                is_logged_in ? 'Not Logged Out Yet' : 'Not Logged Out Yet';

            let isOnTime = false;
            if (in_time) {
                const scheduledTime = moment(`${moment(date).format('YYYY-MM-DD')} ${employeeScheduledTime}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Karachi');
                const loginMoment = moment(`${moment(date).format('YYYY-MM-DD')} ${in_time}`, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Karachi');

                const diffInMinutes = loginMoment.diff(scheduledTime, 'minutes');
                isOnTime = diffInMinutes >= -160 && diffInMinutes <= 16; // Login within 15 minutes before or 16 minutes after scheduled time
            }



            const employeeData = {
                employeeId: employeeDetails ? ._id || 'Unknown',
                employeeName: employeeDetails ? .name || 'Unknown',
                employeeEmail: employeeDetails ? .email || 'Unknown',
                designation: employeeDetails ? .role || 'Unknown',
                loginTime: formattedLoginTime,
                logoutTime: formattedLogoutTime,
                isLoggedIn: is_logged_in,
                date: moment(date).tz('Asia/Karachi').format('YYYY-MM-DD'),
                totalEmployees: totalEmployeeCount,
                isOnTime, // Include the On Time status
            };

            console.log("Employee Data: ", employeeData);

            if (formattedLoginTime !== 'Not Logged In') {
                employeeData.status = formattedLogoutTime === 'Not Logged Out Yet' ? 'Present' : 'Attendance Marked';
                loggedInEmployees.push(employeeData);
            } else {
                employeeData.status = 'Leave';
                leaveEmployees.push(employeeData);
            }
        });

        allEmployees.forEach((employee) => {
            if (!attendanceRecords.some((record) => String(record.employee) === String(employee._id))) {
                leaveEmployees.push({
                    employeeId: employee._id,
                    employeeName: employee.name,
                    employeeEmail: employee.email,
                    designation: employee.designation ? .role || 'Unknown',
                    loginTime: 'Not Logged In',
                    logoutTime: 'Not Logged Out Yet',
                    isLoggedIn: false,
                    date: currentTime.format('YYYY-MM-DD'),
                    status: 'Leave',
                    totalEmployees: totalEmployeeCount,
                });
            }
        });

        return res.status(200).json({ loggedInEmployees, leaveEmployees });
    } catch (error) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};



// Get all attendance records for a specific employee by employeeId
exports.getEmployeeAttendance = async(req, res) => {
    try {
        const { employeeId } = req.params; // Get employeeId from URL params

        // Validate if employee exists
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Fetch all attendance records for the employee and populate breaks
        const attendanceRecords = await Attendance.find({ employee: employeeId })
            .populate('employee', 'name email')
            .populate('breaks') // Populate the breaks field to get all breaks
            .lean();

        if (attendanceRecords.length === 0) {
            return res.status(404).json({ message: 'No attendance records found for this employee' });
        }

        // Initialize counters for total presents, leaves, and breaks
        let totalPresents = 0;
        let totalLeaves = 0;
        let totalBreakMinutes = 0;

        // Format attendance records and calculate total presents, leaves, and breaks
        const formattedRecords = attendanceRecords.map(record => {
            const { in_time, out_time, is_logged_in, date, breaks } = record;

            // Ensure 'date' is a valid Date object and format it properly
            const formattedDate = date instanceof Date ? date.toISOString().split('T')[0] : date;

            // Count presents and leaves
            if (in_time && out_time) {
                totalPresents += 1; // Count present if both login and logout times are present
            } else {
                totalLeaves += 1; // Count leave if either login or logout time is missing
            }

            // Calculate total break duration for the day
            let dailyBreakDuration = 0;
            const breakDetails = breaks.map(b => {
                const breakStart = b.break_start;
                const breakEnd = b.break_end || new Date().toISOString().split('T')[1]; // Use current time if not ended

                // Calculate break duration in minutes
                const breakStartTime = new Date(`1970-01-01T${breakStart}Z`);
                const breakEndTime = new Date(`1970-01-01T${breakEnd}Z`);
                const breakDuration = Math.round((breakEndTime - breakStartTime) / 60000); // duration in minutes

                dailyBreakDuration += breakDuration;

                return {
                    breakStartTime: breakStart,
                    breakEndTime: breakEnd,
                    breakDuration: formatDuration(breakDuration), // Format break duration
                    breakType: b.break_type,
                    breakNotes: b.notes,
                };
            });

            // Add the total break time for this attendance record
            totalBreakMinutes += dailyBreakDuration;

            return {
                loginTime: in_time || 'Not Logged In',
                logoutTime: is_logged_in ? 'Not Logged Out Yet' : out_time || 'Not Logged Out Yet',
                isLoggedIn: is_logged_in,
                date: formattedDate,
                breaks: breakDetails,
                dailyBreakDuration: formatDuration(dailyBreakDuration), // Format total break duration for the day
                employee,
            };
        });

        // Return the attendance records along with the counts for presents, leaves, and break details
        return res.status(200).json({
            attendanceRecords: formattedRecords,
            totalPresents,
            totalLeaves,
            totalBreakMinutes: formatDuration(totalBreakMinutes), // Total break time formatted
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to format duration in hours and minutes
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    let formattedDuration = '';

    if (hours > 0) {
        formattedDuration += `${hours} hour${hours > 1 ? 's' : ''}`;
    }

    if (remainingMinutes > 0) {
        if (hours > 0) {
            formattedDuration += ' and ';
        }
        formattedDuration += `${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
    }

    return formattedDuration || '0 minutes';
}




// Get all present employee record
exports.getPresentEmployees = async(req, res) => {
    try {
        const { employeeId } = req.params; // Get employeeId from URL params



        // Validate if employee exists
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Fetch attendance records where the employee was present (both in_time and out_time are present)
        const presentRecords = await Attendance.find({
                employee: employeeId,
                in_time: { $ne: null },
                out_time: { $ne: null },
            })
            .populate('employee', 'name designation') // Fetch only name and designation from the employee
            .lean();

        if (presentRecords.length === 0) {
            return res.status(404).json({ message: 'No present attendance records found for this employee' });
        }

        // Extract only name and designation from each present record
        const presentEmployeeDetails = presentRecords.map(record => ({
            name: record.employee.name,
            designation: record.employee.designation,
        }));
        // Return the names and designations of employees present
        return res.status(200).json({
            presentEmployees: presentEmployeeDetails,
        });

    } catch (error) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};