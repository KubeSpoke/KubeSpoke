namespace KubeSpoke.Server.Models
{
    public class MergeHookModel
    {
        public string object_kind { get; set; }
        public string event_type { get; set; }
        public User user { get; set; }
        public Project project { get; set; }
        public Repository repository { get; set; }
        public Object_Attributes object_attributes { get; set; }
        public Label1[] labels { get; set; }
        public Changes changes { get; set; }
        public Assignee[] assignees { get; set; }
        public Reviewer[] reviewers { get; set; }
    }

    public class User
    {
        public int? id { get; set; }
        public string name { get; set; }
        public string username { get; set; }
        public string avatar_url { get; set; }
        public string email { get; set; }
    }

    public class Project
    {
        public int? id { get; set; }
        public string name { get; set; }
        public string description { get; set; }
        public string web_url { get; set; }
        public object avatar_url { get; set; }
        public string git_ssh_url { get; set; }
        public string git_http_url { get; set; }
        public string _namespace { get; set; }
        public int? visibility_level { get; set; }
        public string path_with_namespace { get; set; }
        public string default_branch { get; set; }
        public string ci_config_path { get; set; }
        public string homepage { get; set; }
        public string url { get; set; }
        public string ssh_url { get; set; }
        public string http_url { get; set; }
    }

    public class Repository
    {
        public string name { get; set; }
        public string url { get; set; }
        public string description { get; set; }
        public string homepage { get; set; }
    }

    public class Object_Attributes
    {
        public int? id { get; set; }
        public int? iid { get; set; }
        public string target_branch { get; set; }
        public string source_branch { get; set; }
        public int? source_project_id { get; set; }
        public int? author_id { get; set; }
        public int?[] assignee_ids { get; set; }

        public int? assignee_id { get; set; }

        public int?[] reviewer_ids { get; set; }
        public string title { get; set; }
        public string created_at { get; set; }
        public string updated_at { get; set; }
        public string last_edited_at { get; set; }
        public int? last_edited_by_id { get; set; }
        public object milestone_id { get; set; }
        public int? state_id { get; set; }
        public string state { get; set; }
        public bool blocking_discussions_resolved { get; set; }
        public bool work_in_progress { get; set; }
        public bool draft { get; set; }
        public bool first_contribution { get; set; }
        public string merge_status { get; set; }
        public int? target_project_id { get; set; }
        public string description { get; set; }
        public string prepared_at { get; set; }
        public int? total_time_spent { get; set; }
        public int? time_change { get; set; }
        public string human_total_time_spent { get; set; }
        public string human_time_change { get; set; }
        public string human_time_estimate { get; set; }
        public string url { get; set; }
        public Source source { get; set; }
        public Target target { get; set; }
        public Last_Commit last_commit { get; set; }
        public Label[] labels { get; set; }

        /// <summary>
        /// open
        /// close
        /// reopen
        /// update
        /// approved
        /// unapproved
        /// approval
        /// unapproval
        /// merge
        /// </summary>
        public string action { get; set; }

        public string detailed_merge_status { get; set; }
    }

    public class Source
    {
        public string name { get; set; }
        public string description { get; set; }
        public string web_url { get; set; }
        public object avatar_url { get; set; }
        public string git_ssh_url { get; set; }
        public string git_http_url { get; set; }
        public string _namespace { get; set; }
        public int? visibility_level { get; set; }
        public string path_with_namespace { get; set; }
        public string default_branch { get; set; }
        public string homepage { get; set; }
        public string url { get; set; }
        public string ssh_url { get; set; }
        public string http_url { get; set; }
    }

    public class Target
    {
        public string name { get; set; }
        public string description { get; set; }
        public string web_url { get; set; }
        public object avatar_url { get; set; }
        public string git_ssh_url { get; set; }
        public string git_http_url { get; set; }
        public string _namespace { get; set; }
        public int? visibility_level { get; set; }
        public string path_with_namespace { get; set; }
        public string default_branch { get; set; }
        public string homepage { get; set; }
        public string url { get; set; }
        public string ssh_url { get; set; }
        public string http_url { get; set; }
    }

    public class Last_Commit
    {
        public string id { get; set; }
        public string message { get; set; }
        public string title { get; set; }
        public string timestamp { get; set; }
        public string url { get; set; }
        public Author author { get; set; }
    }

    public class Author
    {
        public string name { get; set; }
        public string email { get; set; }
    }

    public class Label
    {
        public int? id { get; set; }
        public string title { get; set; }
        public string color { get; set; }
        public int? project_id { get; set; }
        public string created_at { get; set; }
        public string updated_at { get; set; }
        public bool template { get; set; }
        public string description { get; set; }
        public string type { get; set; }
        public int? group_id { get; set; }
    }

    public class Changes
    {
        public Updated_By_Id updated_by_id { get; set; }
        public Draft draft { get; set; }
        public Updated_At updated_at { get; set; }
        public Labels labels { get; set; }
        public Last_Edited_At last_edited_at { get; set; }
        public Last_Edited_By_Id last_edited_by_id { get; set; }
    }

    public class Updated_By_Id
    {
        public object previous { get; set; }
        public int? current { get; set; }
    }

    public class Draft
    {
        public bool previous { get; set; }
        public bool current { get; set; }
    }

    public class Updated_At
    {
        public string previous { get; set; }
        public string current { get; set; }
    }

    public class Labels
    {
        public Previou[] previous { get; set; }
        public Current[] current { get; set; }
    }

    public class Previou
    {
        public int? id { get; set; }
        public string title { get; set; }
        public string color { get; set; }
        public int? project_id { get; set; }
        public string created_at { get; set; }
        public string updated_at { get; set; }
        public bool template { get; set; }
        public string description { get; set; }
        public string type { get; set; }
        public int? group_id { get; set; }
    }

    public class Current
    {
        public int? id { get; set; }
        public string title { get; set; }
        public string color { get; set; }
        public int? project_id { get; set; }
        public string created_at { get; set; }
        public string updated_at { get; set; }
        public bool template { get; set; }
        public string description { get; set; }
        public string type { get; set; }
        public int? group_id { get; set; }
    }

    public class Last_Edited_At
    {
        public object previous { get; set; }
        public string current { get; set; }
    }

    public class Last_Edited_By_Id
    {
        public object previous { get; set; }
        public int? current { get; set; }
    }

    public class Label1
    {
        public int? id { get; set; }
        public string title { get; set; }
        public string color { get; set; }
        public int? project_id { get; set; }
        public string created_at { get; set; }
        public string updated_at { get; set; }
        public bool template { get; set; }
        public string description { get; set; }
        public string type { get; set; }
        public int? group_id { get; set; }
    }

    public class Assignee
    {
        public int? id { get; set; }
        public string name { get; set; }
        public string username { get; set; }
        public string avatar_url { get; set; }
    }

    public class Reviewer
    {
        public int? id { get; set; }
        public string name { get; set; }
        public string username { get; set; }
        public string avatar_url { get; set; }
    }


}
