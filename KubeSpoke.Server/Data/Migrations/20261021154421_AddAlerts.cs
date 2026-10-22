using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace KubeSpoke.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Alerts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Fingerprint = table.Column<string>(type: "TEXT", nullable: false),
                    Cluster = table.Column<string>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Namespace = table.Column<string>(type: "TEXT", nullable: false),
                    Resource = table.Column<string>(type: "TEXT", nullable: false),
                    Reason = table.Column<string>(type: "TEXT", nullable: false),
                    Message = table.Column<string>(type: "TEXT", nullable: false),
                    Severity = table.Column<string>(type: "TEXT", nullable: false),
                    Count = table.Column<int>(type: "INTEGER", nullable: false),
                    FirstSeenUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ResolvedUtc = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Acked = table.Column<bool>(type: "INTEGER", nullable: false),
                    AckedBy = table.Column<string>(type: "TEXT", nullable: false),
                    AckedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Alerts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Alerts_Fingerprint",
                table: "Alerts",
                column: "Fingerprint",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Alerts_ResolvedUtc",
                table: "Alerts",
                column: "ResolvedUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Alerts");
        }
    }
}
