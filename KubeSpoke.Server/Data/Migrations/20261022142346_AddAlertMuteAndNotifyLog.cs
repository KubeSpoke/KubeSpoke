using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace KubeSpoke.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAlertMuteAndNotifyLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "MuteUntilUtc",
                table: "Alerts",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AlertNotifyLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TimeUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ChannelId = table.Column<long>(type: "INTEGER", nullable: false),
                    Url = table.Column<string>(type: "TEXT", nullable: false),
                    Cluster = table.Column<string>(type: "TEXT", nullable: false),
                    Firing = table.Column<int>(type: "INTEGER", nullable: false),
                    Resolved = table.Column<int>(type: "INTEGER", nullable: false),
                    Success = table.Column<bool>(type: "INTEGER", nullable: false),
                    Message = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AlertNotifyLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AlertNotifyLogs_TimeUtc",
                table: "AlertNotifyLogs",
                column: "TimeUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AlertNotifyLogs");

            migrationBuilder.DropColumn(
                name: "MuteUntilUtc",
                table: "Alerts");
        }
    }
}
